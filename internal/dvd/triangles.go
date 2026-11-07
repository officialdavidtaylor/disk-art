// SPDX-License-Identifier: GPL-3.0-or-later
package dvd

import "math"

// Freeze this design under triangles-v1. Four Cartesian triangles have an
// 8 mm base and an outward tip, with 0.6 mm guards at both recording boundaries.
const TrianglePattern = "triangles-v1"
const TriangleGuardMM = .6
const TriangleHalfBaseMM = 4.0

func triangleDark(c Config, x, y float64) bool {
	u, v := math.Abs(x), math.Abs(y)
	if v > u {
		u, v = v, u
	}
	base, tip := c.Inner+TriangleGuardMM, c.Outer-TriangleGuardMM
	return u >= base && u <= tip && v <= TriangleHalfBaseMM*(tip-u)/(tip-base)
}

// Intersect y = k*(tip-x) with x=r*cos(phi), y=r*sin(phi).
// Fitting this sloping edge as a radial line would bias the geometry.
func triangleEdgePhase(c Config, r float64, clockwise bool) float64 {
	base, tip := c.Inner+TriangleGuardMM, c.Outer-TriangleGuardMM
	k := TriangleHalfBaseMM / (tip - base)
	value := k * tip / (r * math.Hypot(1, k))
	phase := math.Asin(math.Max(-1, math.Min(1, value))) - math.Atan(k)
	if !clockwise {
		phase = -phase
	}
	return phase
}

func tracePhase(q CalibrationRequest, source, actual *Geometry, radius float64) float64 {
	s, a := actual.atRadius(radius)
	sourceRadius, b := source.Polar(s / (source.c.BitLength * 1e-6))
	phase := a - b
	if q.Mode == TrianglePattern {
		phase += triangleEdgePhase(q.Basis, sourceRadius, q.TriangleEdge == "clockwise")
	}
	return phase
}

type PhaseStation struct {
	Radius  float64 `json:"radius"`
	Degrees float64 `json:"degrees"`
}
type AngularDiagnostics struct {
	InnerDeltaMM         float64        `json:"innerDeltaMM"`
	OuterDeltaMM         float64        `json:"outerDeltaMM"`
	DriftDegrees         float64        `json:"driftDegrees"`
	PeakToPeakDegrees    float64        `json:"peakToPeakDegrees"`
	InnerPitchNM         float64        `json:"innerPitchNM"`
	OuterPitchNM         float64        `json:"outerPitchNM"`
	PhotoRotationDegrees float64        `json:"photoRotationDegrees"`
	Stations             []PhaseStation `json:"stations"`
}

func angularDiagnostics(source, actual *Geometry, from, to, rotation float64) *AngularDiagnostics {
	d := &AngularDiagnostics{InnerDeltaMM: actual.c.Inner - source.c.Inner, OuterDeltaMM: actual.c.Outer - source.c.Outer,
		InnerPitchNM: 2 * math.Pi * actual.b * actual.shape(actual.c.Inner) * 1e6, OuterPitchNM: 2 * math.Pi * actual.b * actual.shape(actual.c.Outer) * 1e6,
		PhotoRotationDegrees: math.Remainder(rotation, 2*math.Pi) * 180 / math.Pi}
	start := linePhase(source, actual, from)
	lo, hi := 0.0, 0.0
	for i := 0; i <= 64; i++ {
		r := from + (to-from)*float64(i)/64
		degrees := (linePhase(source, actual, r) - start) * 180 / math.Pi
		d.Stations = append(d.Stations, PhaseStation{r, degrees})
		lo = math.Min(lo, degrees)
		hi = math.Max(hi, degrees)
	}
	d.DriftDegrees = d.Stations[len(d.Stations)-1].Degrees
	d.PeakToPeakDegrees = hi - lo
	return d
}
