// SPDX-License-Identifier: GPL-3.0-or-later
// DVD texture/scrambler conventions adapted from DiscImageStudio (see NOTICE).
package dvd

import (
	"errors"
	"math"
)

var seeds = [16]uint16{0x0001, 0x5500, 0x0002, 0x2a00, 0x0004, 0x5400, 0x0008, 0x2800, 0x0010, 0x5000, 0x0020, 0x2001, 0x0040, 0x4002, 0x0080, 0x0005}
var masks = makeMasks()

func makeMasks() (out [16][SectorBytes]byte) {
	for k, seed := range seeds {
		s := seed
		for i := 0; i < SectorBytes; i++ {
			out[k][i] = byte(s)
			for j := 0; j < 8; j++ {
				s = ((s << 1) | ((s>>14)^(s>>10))&1) & 0x7fff
			}
		}
	}
	return
}
func ScramblerMask(lba uint32) [SectorBytes]byte { return masks[((lba+0x30000)>>4)&15] }

type Encoder struct {
	Config   Config
	geometry *Geometry
	image    []byte
	size     int
	prefix   []byte
	pattern  string
	sweep    []SweepBand
}

func NewEncoder(c Config, gray []byte, size int) (*Encoder, error) {
	if size < 2 || size > 4096 || len(gray) != size*size {
		return nil, errors.New("invalid artwork raster")
	}
	g, err := NewGeometry(c)
	if err != nil {
		return nil, err
	}
	volume := c.OutputSectors
	if volume == 0 {
		volume = c.Sectors
	}
	return &Encoder{Config: c, geometry: g, image: gray, size: size, prefix: ISOPrefix(volume)}, nil
}

func (e *Encoder) Fill(start uint32, out []byte) error {
	volume := e.Config.OutputSectors
	if volume == 0 {
		volume = e.Config.Sectors
	}
	if len(out)%SectorBytes != 0 || uint64(start)+uint64(len(out)/SectorBytes) > uint64(volume) {
		return errors.New("invalid ISO sector range")
	}
	scale := float64(e.size) / (2 * e.Config.Outer)
	for n := 0; n < len(out)/SectorBytes; n++ {
		lba := start + uint32(n)
		dst := out[n*SectorBytes : (n+1)*SectorBytes]
		if lba < MetadataSectors {
			copy(dst, e.prefix[int(lba)*SectorBytes:(int(lba)+1)*SectorBytes])
			continue
		}
		mask := &masks[((lba+0x30000)>>4)&15]
		if e.pattern == "bands" {
			edges := BandSectors(e.Config.Sectors)
			texture := byte(0x92)
			for k := 0; k < 6; k += 2 {
				if lba >= edges[k] && lba < edges[k+1] {
					texture = 0xa5
				}
			}
			for i := range dst {
				dst[i] = texture ^ mask[i]
			}
			continue
		}
		var band *SweepBand
		if e.pattern == SweepPattern {
			band = sweepBandAt(e.sweep, lba)
			if band == nil {
				for i := range dst {
					dst[i] = 0x92 ^ mask[i]
				}
				continue
			}
		}
		// Restart at every sync boundary. Within a <=91-word span, a complex
		// rotation follows the circle instead of linearly approximating its chord.
		// Radial drift is included. Error against exact spiral samples is tested.
		for i := 0; i < SectorBytes; {
			col := (i + 12) % 172
			count := 91 - col%91
			if col >= 91 {
				count = 172 - col
			}
			if count > SectorBytes-i {
				count = SectorBytes - i
			}
			channel := float64(lba)*ChannelBitsPerSector + float64(PayloadChannel(i))
			r, angle := e.geometry.Polar(channel)
			rate := 1.0
			if band != nil {
				rate = band.Rate
				angle += (rate - 1) * (angle - band.anchor)
			}
			sine, cosine := math.Sincos(angle)
			stepArc := 16 * e.Config.BitLength * 1e-6
			da := rate * stepArc / r
			ds, dc := math.Sincos(da)
			dr := stepArc / e.geometry.ds(r)
			for j := 0; j < count; j++ {
				x := int((r*cosine + e.Config.Outer) * scale)
				y := int((r*sine + e.Config.Outer) * scale)
				texture := byte(0x92)
				dark := x >= 0 && x < e.size && y >= 0 && y < e.size && e.image[y*e.size+x] < 128
				if e.pattern == "line" {
					dark = cosine > 0 && math.Abs(r*sine) < .6
				}
				if band != nil {
					dark = sine > 0
				}
				if e.pattern == TrianglePattern {
					dark = triangleDark(e.Config, r*cosine, r*sine)
				}
				if dark {
					texture = 0xa5
				}
				dst[i+j] = texture ^ mask[i+j]
				cosine, sine = cosine*dc-sine*ds, sine*dc+cosine*ds
				r += dr
			}
			i += count
		}
	}
	return nil
}
