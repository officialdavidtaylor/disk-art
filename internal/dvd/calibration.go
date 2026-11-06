// SPDX-License-Identifier: GPL-3.0-or-later
// Address bands and phase-difference calibration follow DiscImageStudio; see NOTICE.
package dvd

import (
	"errors"
	"math"
)

// Fractions of the complete logical recording area, rounded up to sector boundaries.
var BandEdges = [6]int{35, 170, 305, 510, 705, 955}

func BandSectors(sectors uint32) [6]uint32 {
	var out [6]uint32
	for i, v := range BandEdges {
		out[i] = (sectors*uint32(v) + 999) / 1000
	}
	return out
}

func NewCalibrationEncoder(c Config, pattern string) (*Encoder, error) {
	if pattern != "bands" && pattern != "line" {
		return nil, errors.New("unknown calibration pattern")
	}
	if c.OutputSectors != 0 && c.OutputSectors != c.Sectors {
		return nil, errors.New("calibration requires a full-disc export")
	}
	e, err := NewEncoder(c, []byte{255, 255, 255, 255}, 2)
	if err != nil {
		return nil, err
	}
	e.pattern = pattern
	return e, nil
}

type Point struct {
	X float64 `json:"x"`
	Y float64 `json:"y"`
}
type CalibrationRequest struct {
	Mode     string    `json:"mode"`
	Basis    Config    `json:"basis"`
	Radii    []float64 `json:"radii"`
	Points   []Point   `json:"points"`
	FitPitch bool      `json:"fitPitch"`
}
type CalibrationResult struct {
	Geometry Config   `json:"geometry"`
	RMS      float64  `json:"rms"`
	MaxError float64  `json:"maxError"`
	Rotation float64  `json:"rotation"`
	Warnings []string `json:"warnings"`
	Curve    []Point  `json:"curve,omitempty"`
}

func Calibrate(q CalibrationRequest) (*CalibrationResult, error) {
	if err := q.Basis.Validate(); err != nil {
		return nil, err
	}
	if q.Mode == "bands" {
		return fitBands(q)
	}
	if q.Mode == "line" {
		return fitLine(q)
	}
	return nil, errors.New("unknown calibration mode")
}

func fitBands(q CalibrationRequest) (*CalibrationResult, error) {
	if len(q.Radii) != 6 {
		return nil, errors.New("measure all six band edges, from the centre outward")
	}
	edges := BandSectors(q.Basis.Sectors)
	var sx, sy, sxx, sxy float64
	for i, r := range q.Radii {
		if !finite(r) || r < 20 || r > 59 || (i > 0 && r <= q.Radii[i-1]) {
			return nil, errors.New("band radii must increase from 20 to 59 mm; enter radii, not diameters")
		}
		x := float64(edges[i]) / float64(q.Basis.Sectors)
		sy += r * r
		sx += x
		sxx += x * x
		sxy += x * r * r
	}
	slope := (6*sxy - sx*sy) / (6*sxx - sx*sx)
	intercept := (sy - slope*sx) / 6
	if intercept <= 0 || slope <= 0 {
		return nil, errors.New("these measurements do not describe a DVD recording area")
	}
	c := q.Basis
	c.OutputSectors = 0
	c.Inner = math.Sqrt(intercept)
	c.Outer = math.Sqrt(intercept + slope)
	c.PitchLinear = 0
	c.PitchQuadratic = 0
	c.PitchCubic = 0
	if err := c.Validate(); err != nil {
		return nil, errors.New("fitted recording area is outside DVD limits; check photo scale and edge order")
	}
	result := &CalibrationResult{Geometry: c, Warnings: []string{"Coarse fit only. Use a new line-pattern burn to refine spiral distortion."}}
	for i, r := range q.Radii {
		e := r - math.Sqrt(intercept+slope*float64(edges[i])/float64(c.Sectors))
		result.RMS += e * e
		result.MaxError = math.Max(result.MaxError, math.Abs(e))
	}
	result.RMS = math.Sqrt(result.RMS / 6)
	if result.RMS > .15 {
		return nil, errors.New("band edges disagree by more than 0.15 mm RMS; recheck the disc centre, photo scale and six transitions")
	}
	return result, nil
}

func finite(v float64) bool { return !math.IsNaN(v) && !math.IsInf(v, 0) }

// Forward radius lookup uses the same physical model as the encoder. A short
// continuation avoids treating imprecise photo endpoints as hard constraints.
func (g *Geometry) atRadius(r float64) (arc, angle float64) {
	i := int(math.Floor((r - g.c.Inner) / g.step))
	if i < 0 || i >= geometrySteps {
		boundary := g.c.Inner
		if i >= geometrySteps {
			boundary = g.c.Outer
			arc = g.arc[geometrySteps]
			angle = g.angle[geometrySteps]
		}
		h := (r - boundary) / 64
		for j := 0; j < 64; j++ {
			x := boundary + float64(j)*h
			arc += h * (g.ds(x) + 4*g.ds(x+h/2) + g.ds(x+h)) / 6
			angle += h * (g.da(x) + 4*g.da(x+h/2) + g.da(x+h)) / 6
		}
	} else {
		r0 := g.c.Inner + float64(i)*g.step
		t := (r - r0) / g.step
		arc = hermite(t, g.arc[i], g.arc[i+1], g.ds(r0)*g.step, g.ds(r0+g.step)*g.step)
		angle = hermite(t, g.angle[i], g.angle[i+1], g.da(r0)*g.step, g.da(r0+g.step)*g.step)
	}
	angle -= g.c.StartAngle * math.Pi / 180
	return
}

// The observed line phase is theta_actual(s) - theta_written(s), plus the
// arbitrary rotation of the photograph. Never wrap residuals point-by-point:
// doing so would permit the solver to hop between revolutions.
func linePhase(source, actual *Geometry, radius float64) float64 {
	s, a := actual.atRadius(radius)
	_, b := source.Polar(s / (source.c.BitLength * 1e-6))
	return a - b
}

func fitLine(q CalibrationRequest) (*CalibrationResult, error) {
	n := len(q.Points)
	minimum := 12
	if q.FitPitch {
		minimum = 24
	}
	if n < minimum || n > 2000 {
		return nil, errors.New("trace at least 12 points (24 for variable pitch), up to 2000, along one continuous line")
	}
	radii := make([]float64, n)
	angles := make([]float64, n)
	warnings := []string{}
	for i, p := range q.Points {
		r, a := math.Hypot(p.X, p.Y), math.Atan2(p.Y, p.X)
		if !finite(r) || r < 20 || r > 59 || (i > 0 && r <= radii[i-1]+.01) {
			return nil, errors.New("trace the same line from inside outward; every point must have a larger radius (20–59 mm)")
		}
		radii[i] = r
		if i > 0 {
			d := math.Remainder(a-angles[i-1], 2*math.Pi)
			if math.Abs(d) > math.Pi*.75 {
				return nil, errors.New("adjacent points turn more than 135 degrees; add points between them to preserve the winding")
			}
			if math.Abs(d) > math.Pi/2 && len(warnings) == 0 {
				warnings = append(warnings, "Some points are over 90° apart. Add intermediate points and refit to check the winding.")
			}
			a = angles[i-1] + d
		}
		angles[i] = a
	}
	coverage := (radii[n-1] - radii[0]) / (q.Basis.Outer - q.Basis.Inner)
	if coverage < .65 {
		return nil, errors.New("trace must cover at least 65% of the recording width, including inner, middle and outer regions")
	}
	if q.FitPitch && coverage < .85 {
		return nil, errors.New("variable-pitch fitting needs at least 85% radial coverage")
	}
	source, _ := NewGeometry(q.Basis)
	dim := 2
	if q.FitPitch {
		dim = 5
	}
	scales := []float64{.01, .01, .0001, .0001, .0001}
	config := func(v []float64) Config {
		c := q.Basis
		c.OutputSectors = 0
		c.Inner += v[0] * scales[0]
		c.Outer += v[1] * scales[1]
		if dim == 5 {
			c.PitchLinear += v[2] * scales[2]
			c.PitchQuadratic += v[3] * scales[3]
			c.PitchCubic += v[4] * scales[4]
		}
		return c
	}
	evaluate := func(v []float64) ([]float64, float64, float64) {
		c := config(v)
		if math.Abs(c.Inner-q.Basis.Inner) > .3 || math.Abs(c.Outer-q.Basis.Outer) > .3 || math.Abs(c.PitchLinear) > .005 || math.Abs(c.PitchQuadratic) > .005 || math.Abs(c.PitchCubic) > .005 {
			return nil, 0, math.Inf(1)
		}
		g, err := NewGeometry(c)
		if err != nil {
			return nil, 0, math.Inf(1)
		}
		res := make([]float64, n)
		mean := 0.0
		for i, r := range radii {
			res[i] = angles[i] - linePhase(source, g, r)
			mean += res[i]
		}
		mean /= float64(n)
		cost := 0.0
		for i := range res {
			res[i] -= mean
			cost += res[i] * res[i]
		}
		return res, mean, cost / float64(n)
	}
	x := make([]float64, dim)
	residual, rotation, cost := evaluate(x)
	lambda := .001
	for iter := 0; iter < 65; iter++ {
		jac := make([][]float64, dim)
		for j := 0; j < dim; j++ {
			shifted := append([]float64(nil), x...)
			shifted[j] += .001
			next, _, _ := evaluate(shifted)
			if next == nil {
				return nil, errors.New("fit reached its search boundary; refine the broad-band measurement first")
			}
			jac[j] = make([]float64, n)
			for i := 0; i < n; i++ {
				jac[j][i] = (next[i] - residual[i]) / .001
			}
		}
		a := make([][]float64, dim)
		b := make([]float64, dim)
		for j := 0; j < dim; j++ {
			a[j] = make([]float64, dim)
			for i := 0; i < n; i++ {
				b[j] -= jac[j][i] * residual[i]
				for k := 0; k < dim; k++ {
					a[j][k] += jac[j][i] * jac[k][i]
				}
			}
			a[j][j] += lambda * math.Max(a[j][j], 1e-12)
		}
		delta, ok := solveLinear(a, b)
		if !ok {
			return nil, errors.New("trace cannot constrain these parameters; add points across the disc or disable variable pitch")
		}
		candidate := append([]float64(nil), x...)
		for j := range candidate {
			candidate[j] += delta[j]
		}
		r, rot, next := evaluate(candidate)
		if next < cost {
			improvement := cost - next
			x = candidate
			residual = r
			rotation = rot
			cost = next
			lambda = math.Max(lambda/3, 1e-10)
			if improvement < 1e-13 {
				break
			}
		} else {
			lambda *= 10
			if lambda > 1e12 {
				break
			}
		}
	}
	c := config(x)
	if math.Abs(c.Inner-q.Basis.Inner) > .295 || math.Abs(c.Outer-q.Basis.Outer) > .295 {
		return nil, errors.New("fit reached the 0.3 mm search limit; improve the broad-band measurements first")
	}
	actual, _ := NewGeometry(c)
	result := &CalibrationResult{Geometry: c, Rotation: rotation, Warnings: warnings}
	// Report local perpendicular distance to the predicted curve. This includes
	// radial photo uncertainty without mislabelling radians as millimetres.
	for i, r := range radii {
		d := (linePhase(source, actual, r+.001) - linePhase(source, actual, r-.001)) / .002
		e := residual[i] * r / math.Hypot(1, r*d)
		result.RMS += e * e
		result.MaxError = math.Max(result.MaxError, math.Abs(e))
	}
	result.RMS = math.Sqrt(result.RMS / float64(n))
	if result.RMS > .35 || result.MaxError > 1 {
		return nil, errors.New("line fit is inconsistent (over 0.35 mm RMS or 1 mm maximum); check scale, centre and trace continuity")
	}
	if result.RMS > .12 {
		result.Warnings = append(result.Warnings, "Residuals are noticeable. Check the overlay and refine misplaced points before applying.")
	}
	if q.FitPitch {
		result.Warnings = append(result.Warnings, "Variable pitch adds three fitted parameters. Confirm the result with another line burn to check for overfitting.")
	}
	result.Warnings = append(result.Warnings, "A low residual does not prove the winding is correct. Follow the entire visible line without skipping turns, then verify on a new burn.")
	for r := radii[0]; r <= radii[n-1]; {
		phase := linePhase(source, actual, r) + rotation
		result.Curve = append(result.Curve, Point{r * math.Cos(phase), r * math.Sin(phase)})
		d := (linePhase(source, actual, r+.001) - linePhase(source, actual, r-.001)) / .002
		r += math.Min(.08, .05/math.Max(math.Abs(d), .001))
		if len(result.Curve) > 20000 {
			return nil, errors.New("fitted line has too many turns; improve the coarse calibration")
		}
	}
	return result, nil
}

func solveLinear(a [][]float64, b []float64) ([]float64, bool) {
	n := len(b)
	for j := 0; j < n; j++ {
		p := j
		for i := j + 1; i < n; i++ {
			if math.Abs(a[i][j]) > math.Abs(a[p][j]) {
				p = i
			}
		}
		if math.Abs(a[p][j]) < 1e-20 {
			return nil, false
		}
		a[j], a[p] = a[p], a[j]
		b[j], b[p] = b[p], b[j]
		v := a[j][j]
		for k := j; k < n; k++ {
			a[j][k] /= v
		}
		b[j] /= v
		for i := 0; i < n; i++ {
			if i == j {
				continue
			}
			v = a[i][j]
			for k := j; k < n; k++ {
				a[i][k] -= v * a[j][k]
			}
			b[i] -= v * b[j]
		}
	}
	return b, true
}
