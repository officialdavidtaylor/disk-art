package dvd

import (
	"math"
	"testing"
)

// Construct points from Cartesian edges, then forward-map their recording
// addresses into a different physical spiral. This does not use the fitter's
// triangle edge equation and catches sign / edge / rotation mistakes.
func triangleObservation(source, actual *Geometry, x, sign, rotation float64) Point {
	y := sign * TriangleHalfBaseMM * (source.c.Outer - TriangleGuardMM - x) / (source.c.Outer - source.c.Inner - 2*TriangleGuardMM)
	radius := math.Hypot(x, y)
	arc, a := source.atRadius(radius)
	r, b := actual.Polar(arc / (source.c.BitLength * 1e-6))
	phase := b - a + math.Atan2(y, x) + rotation
	return Point{r * math.Cos(phase), r * math.Sin(phase)}
}

func TestTriangleEdgeGeometry(t *testing.T) {
	c := calibrationConfig()
	for _, sign := range []float64{-1, 1} {
		for i := 0; i <= 100; i++ {
			x := 25 + 32*float64(i)/100
			y := sign * 4 * (57.4 - x) / 32.8
			r := math.Hypot(x, y)
			if math.Abs(triangleEdgePhase(c, r, sign > 0)-math.Atan2(y, x)) > 1e-14 {
				t.Fatal("triangle / circular edge mismatch")
			}
		}
	}
	for arm := 0; arm < 4; arm++ {
		a := float64(arm) * math.Pi / 2
		for _, p := range []struct {
			x, y float64
			dark bool
		}{{30, 0, true}, {30, 3, true}, {30, 4, false}, {24.5, 0, false}, {57.5, 0, false}, {57.3, 0, true}} {
			x := p.x*math.Cos(a) - p.y*math.Sin(a)
			y := p.x*math.Sin(a) + p.y*math.Cos(a)
			if triangleDark(c, x, y) != p.dark {
				t.Fatalf("wrong triangle at %v arm %d", p, arm)
			}
		}
	}
}

func TestTriangleFitsRecoverRadiiPitchAndRotation(t *testing.T) {
	for _, pitch := range []bool{false, true} {
		for _, sign := range []float64{-1, 1} {
			c := calibrationConfig()
			c.StartAngle = 23
			a := c
			a.Inner += .014
			a.Outer -= .008
			if pitch {
				a.PitchLinear = -.000045
				a.PitchQuadratic = .000095
				a.PitchCubic = -.000053
			}
			source, _ := NewGeometry(c)
			actual, _ := NewGeometry(a)
			rotation := 2.73
			q := CalibrationRequest{Mode: TrianglePattern, Basis: c, FitPitch: pitch, TriangleEdge: "clockwise"}
			if sign < 0 {
				q.TriangleEdge = "counterclockwise"
			}
			for i := 0; i <= 240; i++ {
				q.Points = append(q.Points, triangleObservation(source, actual, 25.2+31.8*float64(i)/240, sign, rotation))
			}
			fit, err := Calibrate(q)
			if err != nil {
				t.Fatal(err)
			}
			if math.Abs(fit.Geometry.Inner-a.Inner) > 3e-6 || math.Abs(fit.Geometry.Outer-a.Outer) > 3e-6 {
				t.Fatalf("wrong triangle fit: %+v", fit.Geometry)
			}
			if pitch && (math.Abs(fit.Geometry.PitchLinear-a.PitchLinear) > 3e-6 || math.Abs(fit.Geometry.PitchQuadratic-a.PitchQuadratic) > 5e-6 || math.Abs(fit.Geometry.PitchCubic-a.PitchCubic) > 3e-6) {
				t.Fatalf("wrong triangle pitch: %+v", fit.Geometry)
			}
			if fit.Geometry.StartAngle != c.StartAngle || fit.Geometry.BitLength != c.BitLength {
				t.Fatal("unidentifiable parameters changed")
			}
			fitted, _ := NewGeometry(fit.Geometry)
			for i := 0; i < 71; i++ {
				p := triangleObservation(source, actual, 25.3+31.5*float64(i)/70, sign, rotation)
				r := math.Hypot(p.X, p.Y)
				delta := math.Remainder(tracePhase(q, source, fitted, r)+fit.Rotation-math.Atan2(p.Y, p.X), 2*math.Pi)
				if math.Abs(delta)*r > .02 {
					t.Fatalf("held-out mismatch: %g mm", delta*r)
				}
			}
			if fit.Diagnostics == nil || len(fit.Diagnostics.Stations) != 65 || math.Abs(fit.Diagnostics.DriftDegrees) < 360 {
				t.Fatalf("missing unwrapped multi-turn diagnostics: %+v", fit.Diagnostics)
			}
		}
	}
}

func TestUndistortedTriangleAndInvalidTrace(t *testing.T) {
	c := calibrationConfig()
	g, _ := NewGeometry(c)
	q := CalibrationRequest{Mode: TrianglePattern, Basis: c, TriangleEdge: "clockwise", FitPitch: true}
	for i := 0; i < 33; i++ {
		q.Points = append(q.Points, triangleObservation(g, g, 25.2+31.8*float64(i)/32, 1, 1.5))
	}
	fit, err := Calibrate(q)
	if err != nil {
		t.Fatal(err)
	}
	if math.Abs(fit.Geometry.Inner-c.Inner) > 1e-6 || math.Abs(fit.Geometry.Outer-c.Outer) > 1e-6 || math.Abs(fit.Diagnostics.DriftDegrees) > .001 {
		t.Fatal("an ideal triangle must not create a geometry correction")
	}
	q.Basis.PitchLinear = .006
	if _, err = Calibrate(q); err == nil {
		t.Fatal("accepted a starting pitch outside the fitting range")
	}
	q.Basis = c
	q.TriangleEdge = ""
	if _, err = Calibrate(q); err == nil {
		t.Fatal("accepted unknown edge")
	}
	q.TriangleEdge = "clockwise"
	q.Points[1] = Point{-q.Points[1].Y, q.Points[1].X}
	if _, err = Calibrate(q); err == nil {
		t.Fatal("accepted a jump to another spoke")
	}
}

func TestTriangleEncoder(t *testing.T) {
	c := calibrationConfig()
	e, err := NewCalibrationEncoder(c, TrianglePattern)
	if err != nil {
		t.Fatal(err)
	}
	g, _ := NewGeometry(c)
	for _, lba := range []uint32{32, 1000, 80329, 210000, 500000, 1000000, 1500000, 2200000, 2295103} {
		data := make([]byte, SectorBytes)
		if err := e.Fill(lba, data); err != nil {
			t.Fatal(err)
		}
		mask := ScramblerMask(lba)
		for i, b := range data {
			r, a := g.Polar(float64(lba)*ChannelBitsPerSector + float64(PayloadChannel(i)))
			x, y := r*math.Cos(a), r*math.Sin(a)
			inside := false
			for arm := 0; arm < 4; arm++ {
				theta := float64(arm) * math.Pi / 2
				u := x*math.Cos(theta) + y*math.Sin(theta)
				v := -x*math.Sin(theta) + y*math.Cos(theta)
				if u >= 24.6 && u <= 57.4 && math.Abs(v) <= 4*(57.4-u)/32.8 {
					inside = true
				}
			}
			want := byte(0x92)
			if inside {
				want = 0xa5
			}
			if b^mask[i] != want {
				t.Fatalf("wrong triangle encoding at %d:%d", lba, i)
			}
		}
	}
}
