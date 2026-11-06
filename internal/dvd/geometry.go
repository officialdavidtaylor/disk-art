// SPDX-License-Identifier: GPL-3.0-or-later
package dvd

import (
	"errors"
	"math"
)

const SectorBytes = 2048
const ChannelBitsPerSector = 38688
const MetadataSectors = 32

type Config struct {
	OutputSectors  uint32  `json:"outputSectors"`
	Sectors        uint32  `json:"sectors"`
	Inner          float64 `json:"inner"`
	Outer          float64 `json:"outer"`
	BitLength      float64 `json:"bitLength"`
	PitchLinear    float64 `json:"pitchLinear"`
	PitchQuadratic float64 `json:"pitchQuadratic"`
	PitchCubic     float64 `json:"pitchCubic"`
	StartAngle     float64 `json:"startAngle"`
}

func (c Config) Validate() error {
	for _, v := range []float64{c.Inner, c.Outer, c.BitLength, c.PitchLinear, c.PitchQuadratic, c.PitchCubic, c.StartAngle} {
		if math.IsNaN(v) || math.IsInf(v, 0) {
			return errors.New("geometry must contain finite numbers")
		}
	}
	if c.Sectors < 256 || c.Sectors > 2298496 || c.Sectors%16 != 0 {
		return errors.New("sector count must be an ECC-aligned single-layer DVD capacity")
	}
	if c.OutputSectors != 0 && (c.OutputSectors < 32 || c.OutputSectors > c.Sectors || c.OutputSectors%16 != 0) {
		return errors.New("invalid export length")
	}
	if c.Inner < 20 || c.Outer > 59 || c.Outer <= c.Inner || c.BitLength < 120 || c.BitLength > 150 {
		return errors.New("invalid DVD geometry")
	}
	if math.Abs(c.PitchLinear)+math.Abs(c.PitchQuadratic)+math.Abs(c.PitchCubic) > .05 {
		return errors.New("pitch correction is outside the supported range")
	}
	return nil
}

// The calibrated pitch model is dr/dθ = b(1 + c1*u + c2*u² + c3*u³).
// Integrate along radius and invert arc length with cubic Hermite interpolation.
// This avoids treating logical payload bytes as adjacent physical channel words:
// ECC, sector headers and sync occupy real space in the spiral.
type Geometry struct {
	c               Config
	b, step, length float64
	arc, angle      []float64
}

const geometrySteps = 8192

func NewGeometry(c Config) (*Geometry, error) {
	if err := c.Validate(); err != nil {
		return nil, err
	}
	g := &Geometry{c: c, step: (c.Outer - c.Inner) / geometrySteps, length: float64(c.Sectors) * ChannelBitsPerSector * c.BitLength * 1e-6}
	g.arc = make([]float64, geometrySteps+1)
	g.angle = make([]float64, geometrySteps+1)
	// Thin-track starting value; the exact arc integrand includes radial motion.
	thin := 0.0
	for i := 0; i < geometrySteps; i++ {
		r := c.Inner + float64(i)*g.step
		thin += g.integrate(r, func(x float64) float64 { return x / g.shape(x) })
	}
	g.b = thin / g.length
	for iteration := 0; iteration < 3; iteration++ {
		for i := 0; i < geometrySteps; i++ {
			r := c.Inner + float64(i)*g.step
			g.arc[i+1] = g.arc[i] + g.integrate(r, g.ds)
			g.angle[i+1] = g.angle[i] + g.integrate(r, g.da)
		}
		g.b *= g.arc[geometrySteps] / g.length
	}
	// The final scale change is at floating-point roundoff for physical DVDs.
	return g, nil
}
func (g *Geometry) shape(r float64) float64 {
	u := (r - g.c.Inner) / (g.c.Outer - g.c.Inner)
	return 1 + u*(g.c.PitchLinear+u*(g.c.PitchQuadratic+u*g.c.PitchCubic))
}
func (g *Geometry) da(r float64) float64 { return 1 / (g.b * g.shape(r)) }
func (g *Geometry) ds(r float64) float64 { return math.Hypot(1, r*g.da(r)) }
func (g *Geometry) integrate(r float64, f func(float64) float64) float64 {
	return g.step * (f(r) + 4*f(r+g.step/2) + f(r+g.step)) / 6
}
func hermite(t, y0, y1, d0, d1 float64) float64 {
	return y0 + t*(d0+t*(3*(y1-y0)-2*d0-d1+t*(2*(y0-y1)+d0+d1)))
}
func (g *Geometry) Polar(channel float64) (r, angle float64) {
	s := channel * g.c.BitLength * 1e-6
	lo, hi := 0, geometrySteps
	for hi-lo > 1 {
		m := (lo + hi) / 2
		if g.arc[m] <= s {
			lo = m
		} else {
			hi = m
		}
	}
	r0 := g.c.Inner + float64(lo)*g.step
	d0, d1 := g.ds(r0)*g.step, g.ds(r0+g.step)*g.step
	t := math.Max(0, math.Min(1, (s-g.arc[lo])/(g.arc[lo+1]-g.arc[lo])))
	for j := 0; j < 2; j++ {
		v := hermite(t, g.arc[lo], g.arc[lo+1], d0, d1)
		t -= (v - s) / (d0 + t*(2*(3*(g.arc[lo+1]-g.arc[lo])-2*d0-d1)+3*t*(2*(g.arc[lo]-g.arc[lo+1])+d0+d1)))
	}
	r = r0 + t*g.step
	angle = hermite(t, g.angle[lo], g.angle[lo+1], g.da(r0)*g.step, g.da(r0+g.step)*g.step) - g.c.StartAngle*math.Pi/180
	return
}

// Center of a payload byte's 16 channel bits within its recording sector.
func PayloadChannel(byteIndex int) int {
	frame := byteIndex + 12
	row, column := frame/172, frame%172
	return row*2976 + (column/91)*1488 + 32 + (column%91)*16 + 8
}
