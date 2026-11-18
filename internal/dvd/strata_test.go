package dvd

import (
	"bytes"
	"math"
	"testing"
)

func strataBaseline() Config                { c := calibrationConfig(); c.Sectors = 2297888; return c }
func strataOptions(h float64) StrataOptions { return StrataOptions{h, WriteSafeLight} }

// Independent thin-track Archimedean model, including the derivative of the
// quadratic phase. Does not call strataRateResidual or strataRoot.
func independentReversals(c, actual Config, o StrataOptions) []float64 {
	p, _ := NewStrataPlan(c, o)
	radius := func(g Config, s float64) float64 {
		return math.Sqrt(g.Inner*g.Inner + (g.Outer*g.Outer-g.Inner*g.Inner)*s/float64(g.Sectors))
	}
	out := []float64{}
	for i, b := range p.Bands {
		a0, a1 := analyticAngle(c, float64(b.Start)), analyticAngle(c, float64(b.End))
		direction := 1.0
		if i%2 == 1 {
			direction = -1
		}
		f := func(s float64) float64 {
			written := 1 + direction*o.HalfRangePPM/1e6*(2*(analyticAngle(c, s)-a0)/(a1-a0)-1)
			return radius(c, s)/radius(actual, s) - written
		}
		lo, hi := float64(b.Start), float64(b.End)
		v0 := f(lo)
		if v0*f(hi) >= 0 {
			return nil
		}
		for k := 0; k < 60; k++ {
			m := (lo + hi) / 2
			if f(m)*v0 > 0 {
				lo = m
			} else {
				hi = m
			}
		}
		out = append(out, radius(actual, (lo+hi)/2))
	}
	return out
}
func TestStrataIndependentRecovery(t *testing.T) {
	c := strataBaseline()
	o := strataOptions(10000)
	for _, di := range []float64{-.2, -.1, 0, .1, .2} {
		for _, do := range []float64{-.2, -.1, 0, .1, .2} {
			a := c
			a.Inner += di
			a.Outer += do
			r := independentReversals(c, a, o)
			if len(r) != 4 {
				t.Fatalf("range missed %.3f %.3f", di, do)
			}
			f, err := FitStrata(StrataFitRequest{c, o, r, true})
			if err != nil {
				t.Fatalf("fit %.3f %.3f: %v", di, do, err)
			}
			if math.Abs(f.Geometry.Inner-a.Inner) > 2e-6 || math.Abs(f.Geometry.Outer-a.Outer) > 2e-6 {
				t.Fatalf("wrong fit %+v", f)
			}
		}
	}
}
func TestStrataThreePassNoise(t *testing.T) {
	c := strataBaseline()
	a := c
	a.Inner += .085
	a.Outer -= .12
	for _, h := range []float64{10000, 1000, 100} {
		o := strataOptions(h)
		r := independentReversals(c, a, o)
		if len(r) != 4 {
			t.Fatalf("narrowed too far at %v", h)
		}
		for i := range r {
			r[i] += []float64{.02, -.025, .01, -.015}[i]
		}
		f, err := FitStrata(StrataFitRequest{c, o, r, true})
		if err != nil {
			t.Fatal(err)
		}
		t.Logf("range %.0f ppm; radius error %.7f / %.7f mm; station RMS %.5f mm", h, f.Geometry.Inner-a.Inner, f.Geometry.Outer-a.Outer, f.RMSMM)
		if math.Abs(f.Geometry.Inner-a.Inner) > h*8e-7 || math.Abs(f.Geometry.Outer-a.Outer) > h*8e-7 {
			t.Fatalf("noisy recovery: %+v", f)
		}
		c = f.Geometry
	}
}
func TestStrataValidation(t *testing.T) {
	c := strataBaseline()
	o := strataOptions(10000)
	r := independentReversals(c, c, o)
	if _, e := FitStrata(StrataFitRequest{c, o, r, false}); e == nil {
		t.Fatal("unconfirmed")
	}
	r[2] += .8
	if _, e := FitStrata(StrataFitRequest{c, o, r, true}); e == nil {
		t.Fatal("accepted wrong reversal")
	}
	for _, bad := range []StrataOptions{{7, WriteSafeLight}, {100, "unknown"}, {math.NaN(), WriteSafeLight}, {999, WriteSafeLight}} {
		if _, e := NewStrataPlan(c, bad); e == nil {
			t.Fatal("invalid recipe")
		}
	}
	c.OutputSectors = 32768
	if _, e := NewStrataEncoder(c, o); e == nil {
		t.Fatal("short export")
	}
}
func TestStrataPayloadAndCompatibility(t *testing.T) {
	c := strataBaseline()
	o := strataOptions(10000)
	p, err := NewStrataPlan(c, o)
	if err != nil {
		t.Fatal(err)
	}
	if len(p.Bands) != 4 || p.CompatibilityChanges != uint64(c.Sectors-32)*512 {
		t.Fatal("wrong plan")
	}
	e, _ := NewStrataEncoder(c, o)
	prefix := make([]byte, MetadataSectors*SectorBytes)
	e.Fill(0, prefix)
	if !bytes.Equal(prefix, ISOPrefix(c.Sectors)) {
		t.Fatal("modified ISO filesystem")
	}
	previous := uint32(32)
	for z, b := range p.Bands {
		if b.Start <= previous || b.Outer-b.Inner < 7 {
			t.Fatal("overlap or too narrow")
		}
		previous = b.End
		for _, lba := range []uint32{b.Start - 1, b.Start, (b.Start + b.End) / 2, b.End - 1, b.End} {
			data := make([]byte, SectorBytes)
			e.Fill(lba, data)
			mask := ScramblerMask(lba)
			for i, got := range data {
				q := byte(0x92)
				if lba >= b.Start && lba < b.End {
					a0, a1 := analyticAngle(c, float64(b.Start)), analyticAngle(c, float64(b.End))
					a := analyticAngle(c, float64(lba)+float64(PayloadChannel(i))/ChannelBitsPerSector)
					d := a - (a0+a1)/2
					direction := 1.0
					if z%2 == 1 {
						direction = -1
					}
					phi := a + direction*o.HalfRangePPM/1e6*d*d/(a1-a0)
					if math.Abs(math.Sin(phi)) < 1e-5 {
						continue
					}
					if math.Sin(phi) > 0 {
						q = 0xa5
					}
				}
				if i%4 == 0 {
					if q == 0xa5 {
						q = []byte{0x3b, 0x3c, 0x63, 0x64}[(i/4)%4]
					} else {
						q = []byte{0x90, 0x94, 0x98, 0x9d}[(i/4)%4]
					}
				}
				if got^mask[i] != q {
					t.Fatalf("stratum %d lba %d byte %d: got %x want %x", z+1, lba, i, got^mask[i], q)
				}
			}
		}
	}
	whole := make([]byte, 64*SectorBytes)
	e.Fill(143000, whole)
	split := make([]byte, len(whole))
	e.Fill(143000, split[:17*SectorBytes])
	e.Fill(143017, split[17*SectorBytes:])
	if !bytes.Equal(whole, split) {
		t.Fatal("chunk-dependent output")
	}
}
