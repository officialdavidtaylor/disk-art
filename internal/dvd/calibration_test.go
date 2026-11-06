package dvd

import (
	"math"
	"testing"
)

func calibrationConfig() Config {
	return Config{Sectors: 2295104, Inner: 24, Outer: 58, BitLength: 133.3}
}

func TestCalibrationBands(t *testing.T) {
	c := calibrationConfig()
	actual := c
	actual.Inner = 24.12
	actual.Outer = 57.94
	g, _ := NewGeometry(actual)
	edges := BandSectors(c.Sectors)
	radii := make([]float64, 6)
	for i, e := range edges {
		radii[i], _ = g.Polar(float64(e) * ChannelBitsPerSector)
	}
	fit, err := Calibrate(CalibrationRequest{Mode: "bands", Basis: c, Radii: radii})
	if err != nil {
		t.Fatal(err)
	}
	if math.Abs(fit.Geometry.Inner-actual.Inner) > 1e-7 || math.Abs(fit.Geometry.Outer-actual.Outer) > 1e-7 {
		t.Fatalf("wrong coarse fit: %+v", fit)
	}
	enc, err := NewCalibrationEncoder(c, "bands")
	if err != nil {
		t.Fatal(err)
	}
	for i, edge := range edges {
		for _, delta := range []int{-1, 0} {
			lba := uint32(int(edge) + delta)
			data := make([]byte, SectorBytes)
			if err := enc.Fill(lba, data); err != nil {
				t.Fatal(err)
			}
			want := byte(0x92)
			if (i%2 == 0 && delta == 0) || (i%2 == 1 && delta == -1) {
				want = 0xa5
			}
			mask := ScramblerMask(lba)
			for j, b := range data {
				if b^mask[j] != want {
					t.Fatalf("wrong band transition %d, %d", i, delta)
				}
			}
		}
	}
	partial := c
	partial.OutputSectors = 32768
	if _, err := NewCalibrationEncoder(partial, "bands"); err == nil {
		t.Fatal("accepted partial calibration")
	}
	radii[3] = radii[2]
	if _, err := Calibrate(CalibrationRequest{Mode: "bands", Basis: c, Radii: radii}); err == nil {
		t.Fatal("accepted duplicate edge")
	}
}

func TestFineCalibrationRecoversGeometry(t *testing.T) {
	for _, pitch := range []bool{false, true} {
		c := calibrationConfig()
		a := c
		a.Inner += .0037
		a.Outer -= .0023
		if pitch {
			a.PitchLinear = -.00004
			a.PitchQuadratic = .00009
			a.PitchCubic = -.00005
		}
		source, _ := NewGeometry(c)
		actual, _ := NewGeometry(a)
		var points []Point
		for i := 0; i < 161; i++ {
			r := 25 + 32*float64(i)/160
			phase := linePhase(source, actual, r) + 1.23
			points = append(points, Point{r * math.Cos(phase), r * math.Sin(phase)})
		}
		fit, err := Calibrate(CalibrationRequest{Mode: "line", Basis: c, Points: points, FitPitch: pitch})
		if err != nil {
			t.Fatal(err)
		}
		if math.Abs(fit.Geometry.Inner-a.Inner) > 2e-6 || math.Abs(fit.Geometry.Outer-a.Outer) > 2e-6 {
			t.Fatalf("wrong fine radii, pitch=%v: %+v", pitch, fit.Geometry)
		}
		if pitch && (math.Abs(fit.Geometry.PitchLinear-a.PitchLinear) > 2e-6 || math.Abs(fit.Geometry.PitchQuadratic-a.PitchQuadratic) > 4e-6 || math.Abs(fit.Geometry.PitchCubic-a.PitchCubic) > 3e-6) {
			t.Fatalf("wrong pitch: %+v", fit.Geometry)
		}
		if fit.RMS > .001 {
			t.Fatalf("wrong fit residual: %g", fit.RMS)
		}
		// Holdout radii are not used in fitting.
		fitted, _ := NewGeometry(fit.Geometry)
		for i := 0; i < 55; i++ {
			r := 25.13 + 31.5*float64(i)/54
			err := math.Remainder(linePhase(source, fitted, r)+fit.Rotation-linePhase(source, actual, r)-1.23, 2*math.Pi)
			if math.Abs(err)*r > .01 {
				t.Fatalf("holdout phase error: %g", err)
			}
		}
	}
}

func TestCalibrationValidationAndLine(t *testing.T) {
	c := calibrationConfig()
	e, _ := NewCalibrationEncoder(c, "line")
	g, _ := NewGeometry(c)
	for _, lba := range []uint32{1000, 500000, 1500000, 2200000} {
		data := make([]byte, 2048)
		if err := e.Fill(lba, data); err != nil {
			t.Fatal(err)
		}
		mask := ScramblerMask(lba)
		for i, b := range data {
			r, a := g.Polar(float64(lba)*ChannelBitsPerSector + float64(PayloadChannel(i)))
			want := byte(0x92)
			if math.Cos(a) > 0 && math.Abs(r*math.Sin(a)) < .6 {
				want = 0xa5
			}
			if b^mask[i] != want {
				t.Fatalf("line encoding mismatch at %d:%d", lba, i)
			}
		}
	}
	bad := []CalibrationRequest{{Mode: "bands", Basis: c, Radii: []float64{24, 25, 30, 50, 55, 58}}, {Mode: "line", Basis: c}, {Mode: "bogus", Basis: c}}
	for _, q := range bad {
		if _, err := Calibrate(q); err == nil {
			t.Fatalf("accepted invalid calibration %+v", q)
		}
	}
}
