package dvd

import (
	"math"
	"testing"
)

func sweepBaseline() Config {
	c := calibrationConfig()
	c.Inner = 24.01779148781394
	c.Outer = 57.82313919831214
	return c
}

// Independent thin-track closed form; its radial-motion omission is below the
// tolerances here. No production phase-difference function generates observations.
func analyticAngle(c Config, sector float64) float64 {
	length := float64(c.Sectors) * ChannelBitsPerSector * c.BitLength * 1e-6
	b := (c.Outer*c.Outer - c.Inner*c.Inner) / (2 * length)
	s := sector * ChannelBitsPerSector * c.BitLength * 1e-6
	return (math.Sqrt(c.Inner*c.Inner+2*b*s)-c.Inner)/b - c.StartAngle*math.Pi/180
}
func independentDrift(source, actual Config, b SweepBand) float64 {
	return analyticAngle(actual, float64(b.End)) - analyticAngle(actual, float64(b.Start)) - b.Rate*(analyticAngle(source, float64(b.End))-analyticAngle(source, float64(b.Start)))
}
func sweepObservations(source, actual Config) []SweepObservation {
	plan, _ := NewSweepPlan(source)
	obs := []SweepObservation{}
	for z := 0; z < 3; z++ {
		best := z * SweepCandidates
		for i := best + 1; i < (z+1)*SweepCandidates; i++ {
			if math.Abs(independentDrift(source, actual, plan.Bands[i])) < math.Abs(independentDrift(source, actual, plan.Bands[best])) {
				best = i
			}
		}
		b := plan.Bands[best]
		rotation := 171.0
		delta := independentDrift(source, actual, b) * 180 / math.Pi
		obs = append(obs, SweepObservation{z + 1, b.Candidate, rotation, math.Remainder(rotation+delta, 360)})
	}
	return obs
}
func TestSweepCoverageAndFit(t *testing.T) {
	base := sweepBaseline()
	for _, di := range []float64{-.2, -.1, 0, .1, .2} {
		for _, do := range []float64{-.2, -.1, 0, .1, .2} {
			actual := base
			actual.Inner += di
			actual.Outer += do
			obs := sweepObservations(base, actual)
			for _, o := range obs {
				if math.Abs(math.Remainder(o.OuterAngle-o.InnerAngle, 360)) > 120 {
					t.Fatalf("no readable candidate at %.3f %.3f: %+v", di, do, o)
				}
			}
			fit, err := FitSweep(SweepFitRequest{base, obs, true})
			if err != nil {
				t.Fatalf("%.3f %.3f: %v", di, do, err)
			}
			if math.Abs(fit.Geometry.Inner-actual.Inner) > 2e-6 || math.Abs(fit.Geometry.Outer-actual.Outer) > 2e-6 {
				t.Fatalf("recovery failed: %+v", fit)
			}
			if fit.Geometry.BitLength != base.BitLength || fit.Geometry.PitchLinear != base.PitchLinear {
				t.Fatal("changed fixed parameters")
			}
		}
	}
	// Nominal 24–58 is explicitly inside the sweep around this measured baseline.
	fit, err := FitSweep(SweepFitRequest{base, sweepObservations(base, calibrationConfig()), true})
	if err != nil || math.Abs(fit.Geometry.Outer-58) > 2e-6 {
		t.Fatalf("nominal recovery: %+v %v", fit, err)
	}
}
func TestSweepValidationAndNoise(t *testing.T) {
	c := sweepBaseline()
	a := c
	a.Inner += .085
	a.Outer -= .12
	obs := sweepObservations(c, a)
	for i := range obs {
		obs[i].OuterAngle += []float64{.7, -.4, .5}[i]
	}
	fit, err := FitSweep(SweepFitRequest{c, obs, true})
	if err != nil {
		t.Fatal(err)
	}
	if math.Abs(fit.Geometry.Inner-a.Inner) > .0005 || math.Abs(fit.Geometry.Outer-a.Outer) > .0005 {
		t.Fatalf("noisy recovery: %+v", fit)
	}
	if _, err = FitSweep(SweepFitRequest{c, obs, false}); err == nil {
		t.Fatal("accepted unconfirmed winding")
	}
	obs[0].Candidate = 22
	if _, err = FitSweep(SweepFitRequest{c, obs, true}); err == nil {
		t.Fatal("accepted unknown candidate")
	}
	obs = sweepObservations(c, a)
	obs[2].Zone = 1
	if _, err = FitSweep(SweepFitRequest{c, obs, true}); err == nil {
		t.Fatal("accepted duplicate group")
	}
	obs = sweepObservations(c, a)
	obs[1].OuterAngle += 60
	if _, err = FitSweep(SweepFitRequest{c, obs, true}); err == nil {
		t.Fatal("accepted inconsistent edge measurements")
	}
	c.OutputSectors = 32768
	if _, err = NewCalibrationEncoder(c, SweepPattern); err == nil {
		t.Fatal("accepted short sweep")
	}
}
func TestSweepEncoderAndFrozenPlan(t *testing.T) {
	c := sweepBaseline()
	plan, err := NewSweepPlan(c)
	if err != nil {
		t.Fatal(err)
	}
	if len(plan.Bands) != 63 {
		t.Fatal("wrong strip count")
	}
	e, err := NewCalibrationEncoder(c, SweepPattern)
	if err != nil {
		t.Fatal(err)
	}
	last := uint32(32)
	for _, b := range plan.Bands {
		if b.Start <= last || b.End <= b.Start || b.End >= c.Sectors {
			t.Fatal("overlapping strip gates")
		}
		last = b.End
		if b.PPM != (b.Candidate-11)*1000 || b.Outer-b.Inner < .3 {
			t.Fatal("wrong correction / unreadably narrow strip")
		}
		for _, lba := range []uint32{b.Start - 1, b.Start, (b.Start + b.End) / 2, b.End - 1, b.End} {
			data := make([]byte, SectorBytes)
			if err = e.Fill(lba, data); err != nil {
				t.Fatal(err)
			}
			mask := ScramblerMask(lba)
			for i, v := range data {
				want := byte(0x92)
				if lba >= b.Start && lba < b.End {
					a := analyticAngle(c, float64(lba)+float64(PayloadChannel(i))/ChannelBitsPerSector)
					mid := analyticAngle(c, float64(b.Start+b.End)/2)
					phi := a + (b.Rate-1)*(a-mid)
					if math.Abs(math.Sin(phi)) < 1e-5 {
						continue
					} // exclude analytic approximation's boundary uncertainty
					if math.Sin(phi) > 0 {
						want = 0xa5
					}
				}
				if v^mask[i] != want {
					t.Fatalf("wrong payload group %d strip %d lba %d byte %d", b.Zone, b.Candidate, lba, i)
				}
			}
		}
	}
}
