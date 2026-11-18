// SPDX-License-Identifier: GPL-3.0-or-later
package dvd

import (
	"errors"
	"math"
)

// Frozen four-stratum chirp. Legacy sweep-v1 remains byte-for-byte unchanged.
const StrataPattern = "strata-v1"
const WriteSafeLight = "write-safe-light-v1"

type StrataOptions struct {
	HalfRangePPM      float64 `json:"halfRangePPM"`
	ReadCompatibility string  `json:"readCompatibility"`
}

func (o StrataOptions) Validate() error {
	if (o.HalfRangePPM != 10000 && o.HalfRangePPM != 1000 && o.HalfRangePPM != 100 && o.HalfRangePPM != 0) || o.ReadCompatibility != WriteSafeLight {
		return errors.New("four-stratum tests require ±1%, ±0.1%, ±0.01% or constant-rate verification, with light compatibility encoding")
	}
	return nil
}

type StrataBand struct {
	Index   int     `json:"index"`
	Start   uint32  `json:"start"`
	End     uint32  `json:"end"`
	Inner   float64 `json:"inner"`
	Outer   float64 `json:"outer"`
	FromPPM float64 `json:"fromPPM"`
	ToPPM   float64 `json:"toPPM"`
	band    SweepBand
}
type StrataPlan struct {
	Pattern              string       `json:"pattern"`
	Bands                []StrataBand `json:"bands"`
	CompatibilityChanges uint64       `json:"compatibilityChanges"`
}

func NewStrataPlan(c Config, o StrataOptions) (*StrataPlan, error) {
	if err := c.Validate(); err != nil {
		return nil, err
	}
	if err := o.Validate(); err != nil {
		return nil, err
	}
	if c.Outer-c.Inner < 28 || (c.OutputSectors != 0 && c.OutputSectors != c.Sectors) {
		return nil, errors.New("four strata require a full disc and at least 28 mm of recording width")
	}
	g, _ := NewGeometry(c)
	p := &StrataPlan{Pattern: StrataPattern, CompatibilityChanges: uint64(c.Sectors-MetadataSectors) * (SectorBytes / 4)}
	width := (c.Outer - c.Inner - 2 - 3*.8) / 4
	sectorMM := ChannelBitsPerSector * c.BitLength * 1e-6
	for i := 0; i < 4; i++ {
		r0 := c.Inner + 1 + float64(i)*(width+.8)
		s0, _ := g.atRadius(r0)
		s1, _ := g.atRadius(r0 + width)
		start, end := uint32(math.Ceil(s0/sectorMM)), uint32(math.Ceil(s1/sectorMM))
		if start < MetadataSectors || end <= start || end >= c.Sectors {
			return nil, errors.New("stratum falls outside the recording area")
		}
		inner, a0 := g.Polar(float64(start) * ChannelBitsPerSector)
		outer, a1 := g.Polar(float64(end) * ChannelBitsPerSector)
		direction := 1.0
		if i%2 == 1 {
			direction = -1
		}
		b := SweepBand{Start: start, End: end, Inner: inner, Outer: outer, Rate: 1, anchor: (a0 + a1) / 2, slope: 2 * direction * o.HalfRangePPM / 1e6 / (a1 - a0)}
		p.Bands = append(p.Bands, StrataBand{i + 1, start, end, inner, outer, -direction * o.HalfRangePPM, direction * o.HalfRangePPM, b})
	}
	return p, nil
}
func NewStrataEncoder(c Config, o StrataOptions) (*Encoder, error) {
	p, err := NewStrataPlan(c, o)
	if err != nil {
		return nil, err
	}
	e, err := NewEncoder(c, []byte{255, 255, 255, 255}, 2)
	if err != nil {
		return nil, err
	}
	e.pattern = StrataPattern
	e.compatibility = true
	for _, b := range p.Bands {
		e.sweep = append(e.sweep, b.band)
	}
	return e, nil
}

// Near-tone substitutions from DiscImageStudio PR #188, level 1. Apply only
// to artwork-owned bytes AFTER palette selection and BEFORE inverse scrambling.
func lightCompatible(q byte, i int) byte {
	if i%4 != 0 {
		return q
	}
	k := (i / 4) % 4
	if q == 0xa5 {
		return [4]byte{0x3b, 0x3c, 0x63, 0x64}[k]
	}
	if q == 0x92 {
		return [4]byte{0x90, 0x94, 0x98, 0x9d}[k]
	}
	return q
}

type StrataFitRequest struct {
	Basis     Config        `json:"basis"`
	Options   StrataOptions `json:"options"`
	Radii     []float64     `json:"radii"`
	Confirmed bool          `json:"confirmed"`
}
type StrataFitResult struct {
	Geometry         Config    `json:"geometry"`
	RMSMM            float64   `json:"rmsMM"`
	MaxMM            float64   `json:"maxMM"`
	RateRMSPPM       float64   `json:"rateRmsPPM"`
	PredictedRadii   []float64 `json:"predictedRadii"`
	NextHalfRangePPM float64   `json:"nextHalfRangePPM"`
}

// At a reversal the physical angular advance per arc length matches the
// derivative of the encoded chirp. Photo rotation and edge polarity cancel.
func strataRateResidual(source, actual *Geometry, b SweepBand, r float64) float64 {
	s, _ := actual.atRadius(r)
	sr, a := source.Polar(s / (source.c.BitLength * 1e-6))
	physical := (actual.da(r) / actual.ds(r)) / (source.da(sr) / source.ds(sr))
	encoded := b.Rate + b.slope*(a-b.anchor)
	return (physical - encoded) * 1e6
}
func strataRoot(source, actual *Geometry, b SweepBand) (float64, error) {
	lo, _ := actual.Polar(float64(b.Start) * ChannelBitsPerSector)
	hi, _ := actual.Polar(float64(b.End) * ChannelBitsPerSector)
	// Require one genuine sign change, not a tangency or an extrapolated root.
	left, right, previous := lo, lo, strataRateResidual(source, actual, b, lo)
	changes := 0
	for i := 1; i <= 64; i++ {
		r := lo + (hi-lo)*float64(i)/64
		v := strataRateResidual(source, actual, b, r)
		if (previous <= 0 && v > 0) || (previous >= 0 && v < 0) {
			left = lo + (hi-lo)*float64(i-1)/64
			right = r
			changes++
		}
		previous = v
	}
	if changes != 1 {
		return 0, errors.New("no unique winding reversal in every stratum; keep the wider range and recheck the measurements")
	}
	v0 := strataRateResidual(source, actual, b, left)
	for i := 0; i < 45; i++ {
		mid := (left + right) / 2
		v := strataRateResidual(source, actual, b, mid)
		if v*v0 > 0 {
			left = mid
			v0 = v
		} else {
			right = mid
		}
	}
	r := (left + right) / 2
	if r < lo+.05*(hi-lo) || r > hi-.05*(hi-lo) {
		return 0, errors.New("a winding reversal is too close to a stratum boundary; use a wider search before narrowing")
	}
	return r, nil
}
func FitStrata(q StrataFitRequest) (*StrataFitResult, error) {
	p, err := NewStrataPlan(q.Basis, q.Options)
	if err != nil {
		return nil, err
	}
	if q.Options.HalfRangePPM == 0 {
		return nil, errors.New("constant-rate verification has no reversal measurements; inspect whether the four boundaries are straight")
	}
	if len(q.Radii) != 4 || !q.Confirmed {
		return nil, errors.New("measure all four winding reversals and confirm that the direction changes on both sides")
	}
	for i, r := range q.Radii {
		if !finite(r) || r < p.Bands[i].Inner-.5 || r > p.Bands[i].Outer+.5 {
			return nil, errors.New("enter one reversal radius in each stratum, counted from the hub outward")
		}
	}
	source, _ := NewGeometry(q.Basis)
	evaluate := func(x []float64) ([]float64, float64) {
		c := q.Basis
		c.OutputSectors = 0
		c.Inner += x[0]
		c.Outer += x[1]
		if math.Abs(x[0]) > .5 || math.Abs(x[1]) > .5 {
			return nil, math.Inf(1)
		}
		g, e := NewGeometry(c)
		if e != nil {
			return nil, math.Inf(1)
		}
		res := make([]float64, 4)
		cost := 0.0
		for i, b := range p.Bands {
			res[i] = strataRateResidual(source, g, b.band, q.Radii[i])
			cost += res[i] * res[i]
		}
		return res, cost
	}
	x := []float64{0, 0}
	res, cost := evaluate(x)
	lambda := .001
	for iter := 0; iter < 60; iter++ {
		jac := make([][]float64, 2)
		for j := 0; j < 2; j++ {
			v := append([]float64{}, x...)
			v[j] += 1e-5
			next, _ := evaluate(v)
			if next == nil {
				return nil, errors.New("fit reached the ±0.5 mm radius search limit")
			}
			jac[j] = make([]float64, 4)
			for i := 0; i < 4; i++ {
				jac[j][i] = (next[i] - res[i]) / 1e-5
			}
		}
		a := [][]float64{{0, 0}, {0, 0}}
		b := []float64{0, 0}
		for j := 0; j < 2; j++ {
			for i := 0; i < 4; i++ {
				b[j] -= jac[j][i] * res[i]
				for k := 0; k < 2; k++ {
					a[j][k] += jac[j][i] * jac[k][i]
				}
			}
			a[j][j] += lambda * math.Max(a[j][j], 1e-12)
		}
		delta, ok := solveLinear(a, b)
		if !ok {
			return nil, errors.New("measurements cannot constrain both radii")
		}
		v := []float64{x[0] + delta[0], x[1] + delta[1]}
		next, ncost := evaluate(v)
		if ncost < cost {
			improvement := cost - ncost
			x, res, cost = v, next, ncost
			lambda = math.Max(lambda/3, 1e-10)
			if improvement < 1e-16 {
				break
			}
		} else {
			lambda *= 10
			if lambda > 1e12 {
				break
			}
		}
	}
	if math.Abs(x[0]) > .495 || math.Abs(x[1]) > .495 {
		return nil, errors.New("fit reached the ±0.5 mm radius limit; recheck the media baseline")
	}
	c := q.Basis
	c.OutputSectors = 0
	c.Inner += x[0]
	c.Outer += x[1]
	actual, _ := NewGeometry(c)
	result := &StrataFitResult{Geometry: c, RateRMSPPM: math.Sqrt(cost / 4), NextHalfRangePPM: math.Max(100, q.Options.HalfRangePPM/10)}
	for i, b := range p.Bands {
		r, e := strataRoot(source, actual, b.band)
		if e != nil {
			return nil, e
		}
		result.PredictedRadii = append(result.PredictedRadii, r)
		d := r - q.Radii[i]
		result.RMSMM += d * d
		result.MaxMM = math.Max(result.MaxMM, math.Abs(d))
	}
	result.RMSMM = math.Sqrt(result.RMSMM / 4)
	if result.RMSMM > .08 || result.MaxMM > .15 {
		return nil, errors.New("the four reversal positions disagree; recheck the centre, scale and reversals before another burn")
	}
	return result, nil
}
