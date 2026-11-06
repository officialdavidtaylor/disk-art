package dvd

import (
	"bytes"
	"encoding/binary"
	"math"
	"testing"
)

func standard() Config { return Config{Sectors: 2295104, Inner: 24, Outer: 58, BitLength: 133.3} }
func TestPayloadPhysicalLocations(t *testing.T) {
	// ECMA-267: 12-byte header, 172 data columns, 10 PI columns,
	// two 32-bit syncs per row, 13 recording rows per sector.
 cases := map[int]int{0: 232, 78: 1480, 79: 1528, 159: 2808, 160: 3016, 2047: 35480}
	for i, want := range cases {
		if got := PayloadChannel(i); got != want {
			t.Errorf("payload %d: %d, want %d", i, got, want)
		}
	}
}
func TestScrambler(t *testing.T) {
	// Sequence from the ECMA-267 15-stage register, initial preset 0001.
	mask := ScramblerMask(0)
 want := []byte{0x01, 0x00, 0x22, 0x04, 0x04, 0x88, 0x98, 0x02}
	if !bytes.Equal(mask[:len(want)], want) {
		t.Fatalf("scrambler prefix %x", mask[:len(want)])
	}
	if ScramblerMask(15) != mask || ScramblerMask(16) == mask || ScramblerMask(256) != mask {
		t.Fatal("incorrect physical-sector seed selection")
	}
}
func TestGeometryAgainstArchimedean(t *testing.T) {
	c := standard()
	g, err := NewGeometry(c)
	if err != nil {
		t.Fatal(err)
	}
	primitive := func(r, b float64) float64 { return .5 * (r*math.Hypot(r, b) + b*b*math.Asinh(r/b)) }
	length := float64(c.Sectors) * ChannelBitsPerSector * c.BitLength * 1e-6
	lo, hi := 1e-9, 1e-3
	for i := 0; i < 100; i++ {
		b := (lo + hi) / 2
		if (primitive(c.Outer, b)-primitive(c.Inner, b))/b > length {
			lo = b
		} else {
			hi = b
		}
	}
	b := (lo + hi) / 2
	for _, fraction := range []float64{0, .0001, .01, .1, .5, .999, 1} {
		s := fraction * length
		r := math.Sqrt(c.Inner*c.Inner + 2*b*s)
		for i := 0; i < 3; i++ {
			r -= ((primitive(r, b)-primitive(c.Inner, b))/b - s) / (math.Hypot(r, b) / b)
		}
		gotR, gotA := g.Polar(fraction * float64(c.Sectors) * ChannelBitsPerSector)
		if math.Abs(gotR-r) > 1e-8 || math.Abs(gotA-(r-c.Inner)/b) > 1e-7 {
			t.Fatalf("geometry at %g: radius error %.12g, angle error %.12g", fraction, gotR-r, gotA-(r-c.Inner)/b)
		}
	}
}
func TestTextureRoundTripAndChunkBoundaries(t *testing.T) {
	c := standard()
	size := 256
	gray := make([]byte, size*size)
	for y := 0; y < size; y++ {
		for x := 0; x < size; x++ {
			if (x/11+y/13)%2 == 0 {
				gray[y*size+x] = 255
			}
		}
	}
	e, err := NewEncoder(c, gray, size)
	if err != nil {
		t.Fatal(err)
	}
	disagreements, total := 0, 0
	for _, start := range []uint32{0, 31, 32, 255, 1000000, 2295088} {
		data := make([]byte, 16*SectorBytes)
		if err = e.Fill(start, data); err != nil {
			t.Fatal(err)
		}
		for n := 0; n < 16; n++ {
			one := make([]byte, SectorBytes)
			if err = e.Fill(start+uint32(n), one); err != nil {
				t.Fatal(err)
			}
			if !bytes.Equal(one, data[n*SectorBytes:(n+1)*SectorBytes]) {
				t.Fatal("chunk boundary changed ISO bytes")
			}
			lba := start + uint32(n)
			if lba < MetadataSectors {
				continue
			}
			mask := ScramblerMask(lba)
			for i, q := range one {
				r, a := e.geometry.Polar(float64(lba)*ChannelBitsPerSector + float64(PayloadChannel(i)))
				x, y := int((r*math.Cos(a)+c.Outer)*float64(size)/(2*c.Outer)), int((r*math.Sin(a)+c.Outer)*float64(size)/(2*c.Outer))
				want := byte(0x92)
				if x >= 0 && x < size && y >= 0 && y < size && gray[y*size+x] < 128 {
					want = 0xa5
				}
				if q^mask[i] != want {
					disagreements++
				}
				total++
			}
		}
	}
	if disagreements > 0 {
		t.Fatalf("%d of %d words differ from exact channel-center sampling", disagreements, total)
	}
	if e.Fill(c.Sectors, make([]byte, SectorBytes)) == nil {
		t.Fatal("accepted capacity overrun")
	}
}
func TestFilesystem(t *testing.T) {
	p := ISOPrefix(2295104)
	v := p[16*SectorBytes : 17*SectorBytes]
	if string(v[1:6]) != "CD001" || binary.LittleEndian.Uint32(v[80:]) != 2295104 || binary.BigEndian.Uint32(v[84:]) != 2295104 {
		t.Fatal("invalid volume descriptor")
	}
	root := p[20*SectorBytes : 21*SectorBytes]
	names := []string{}
	for offset := 0; root[offset] != 0; offset += int(root[offset]) {
		r := root[offset : offset+int(root[offset])]
		name := string(r[33 : 33+int(r[32])])
		extent, length := binary.LittleEndian.Uint32(r[2:]), binary.LittleEndian.Uint32(r[10:])
		if extent*SectorBytes+length > uint32(len(p)) {
			t.Fatal("file escapes metadata")
		}
		if len(name) > 1 {
			names = append(names, name)
		}
	}
	if len(names) != 2 || names[0] != "README.TXT;1" || names[1] != "WEBSITE.URL;1" {
		t.Fatal(names)
	}
	if string(p[22*SectorBytes:22*SectorBytes+len(Shortcut)]) != Shortcut {
		t.Fatal("website shortcut corrupted")
	}
}
func TestImageProcessing(t *testing.T) {
	const size = 128
	rgba := make([]byte, size*size*4)
	for i := 0; i < size*size; i++ {
		rgba[i*4] = 128
		rgba[i*4+1] = 128
		rgba[i*4+2] = 128
		rgba[i*4+3] = 255
	}
	tone := Tone{Contrast: 1, Gamma: 1, Threshold: .5, Dither: true}
	gray, err := Process(rgba, size, tone)
	if err != nil {
		t.Fatal(err)
	}
	white := 0
	for _, v := range gray {
		if v == 255 {
			white++
		} else if v != 0 {
			t.Fatal("not a binary texture")
		}
	}
	if math.Abs(float64(white)/float64(size*size)-128.0/255) > .01 {
		t.Fatal("dithering does not preserve midtone coverage")
	}
	clear(rgba)
	tone.Dither = false
	gray, err = Process(rgba, size, tone)
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Count(gray, []byte{255}) != size*size {
		t.Fatal("transparency did not composite on white")
	}
}
func TestValidation(t *testing.T) {
	for _, mutate := range []func(*Config){func(c *Config) { c.Sectors++ }, func(c *Config) { c.Inner = c.Outer }, func(c *Config) { c.BitLength = math.NaN() }, func(c *Config) { c.OutputSectors = c.Sectors + 16 }} {
		c := standard()
		mutate(&c)
		if _, err := NewGeometry(c); err == nil {
			t.Fatal("accepted invalid geometry")
		}
	}
}
