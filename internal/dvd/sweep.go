// SPDX-License-Identifier: GPL-3.0-or-later
package dvd

import (
	"errors"
	"math"
)

// Versioned optical search target. Do not change these constants without a new ID.
const SweepPattern = "sweep-v1"
const SweepCandidates = 21

type SweepBand struct {
	Zone      int     `json:"zone"`
	Candidate int     `json:"candidate"`
	PPM       int     `json:"ppm"`
	Start     uint32  `json:"start"`
	End       uint32  `json:"end"`
	Inner     float64 `json:"inner"`
	Outer     float64 `json:"outer"`
	Rate      float64 `json:"rate"`
	anchor    float64
}

type SweepPlan struct {
	Pattern  string      `json:"pattern"`
	Geometry Config      `json:"geometry"`
	Bands    []SweepBand `json:"bands"`
}

func NewSweepPlan(c Config) (*SweepPlan, error) {
	if err := c.Validate(); err != nil {
		return nil, err
	}
	if c.Outer-c.Inner < 28 {
		return nil, errors.New("angular sweep needs at least 28 mm of recording width")
	}
	if c.OutputSectors != 0 && c.OutputSectors != c.Sectors {
		return nil, errors.New("angular sweep requires a full-disc export")
	}
	c.OutputSectors = 0
	g, _ := NewGeometry(c)
	p := &SweepPlan{Pattern: SweepPattern, Geometry: c}
	bankWidth := (c.Outer - c.Inner - 4) / 3
	cell := (bankWidth - .4) / SweepCandidates
	sectorMM := ChannelBitsPerSector * c.BitLength * 1e-6
	for zone := 0; zone < 3; zone++ {
		for i := 0; i < SweepCandidates; i++ {
			r0 := c.Inner + 1 + float64(zone)*(bankWidth+1) + float64(i)*cell + .1*float64(i/5) + .05
			r1 := r0 + cell - .1
			s0, _ := g.atRadius(r0)
			s1, _ := g.atRadius(r1)
			// Whole-sector gates preserve each candidate's identity under any spiral geometry.
			start, end := uint32(math.Ceil(s0/sectorMM)), uint32(math.Ceil(s1/sectorMM))
			if start < MetadataSectors || end <= start || end >= c.Sectors {
				return nil, errors.New("sweep strip falls outside recording area")
			}
			inner, _ := g.Polar(float64(start) * ChannelBitsPerSector)
			outer, _ := g.Polar(float64(end) * ChannelBitsPerSector)
			_, anchor := g.Polar(float64(start+end) / 2 * ChannelBitsPerSector)
			ppm := (i - 10) * 1000
			p.Bands = append(p.Bands, SweepBand{zone + 1, i + 1, ppm, start, end, inner, outer, 1 + float64(ppm)/1e6, anchor})
		}
	}
	return p, nil
}

func sweepBandAt(bands []SweepBand, lba uint32) *SweepBand {
	lo, hi := 0, len(bands)
	for lo < hi {
		m := (lo + hi) / 2
		if bands[m].End <= lba {
			lo = m + 1
		} else {
			hi = m
		}
	}
	if lo < len(bands) && lba >= bands[lo].Start {
		return &bands[lo]
	}
	return nil
}

type SweepObservation struct {
	Zone       int     `json:"zone"`
	Candidate  int     `json:"candidate"`
	InnerAngle float64 `json:"innerAngle"`
	OuterAngle float64 `json:"outerAngle"`
}
type SweepFitRequest struct {
	Basis        Config             `json:"basis"`
	Observations []SweepObservation `json:"observations"`
	Continuous   bool               `json:"continuous"`
}
type SweepReading struct {
	Zone             int     `json:"zone"`
	Candidate        int     `json:"candidate"`
	MeasuredDegrees  float64 `json:"measuredDegrees"`
	PredictedDegrees float64 `json:"predictedDegrees"`
}
type SweepFitResult struct {
	Geometry   Config         `json:"geometry"`
	RMSDegrees float64        `json:"rmsDegrees"`
	MaxDegrees float64        `json:"maxDegrees"`
	Readings   []SweepReading `json:"readings"`
	Warnings   []string       `json:"warnings"`
}

// Signed edge motion across a sector-gated patch. Photo rotation and which of
// the two opposite edges is chosen cancel. No residual wrapping during fitting.
func sweepDrift(source, actual *Geometry, b SweepBand) float64 {
	_, a0 := actual.Polar(float64(b.Start) * ChannelBitsPerSector)
	_, a1 := actual.Polar(float64(b.End) * ChannelBitsPerSector)
	_, s0 := source.Polar(float64(b.Start) * ChannelBitsPerSector)
	_, s1 := source.Polar(float64(b.End) * ChannelBitsPerSector)
	return (a1 - a0) - b.Rate*(s1-s0)
}

func FitSweep(q SweepFitRequest) (*SweepFitResult, error) {
	plan, err := NewSweepPlan(q.Basis)
	if err != nil {
		return nil, err
	}
	if len(q.Observations) != 3 || !q.Continuous {
		return nil, errors.New("measure one continuous, least-winding strip in each group and confirm there are no hidden turns")
	}
	source, _ := NewGeometry(plan.Geometry)
	bands := make([]SweepBand, 3)
	measured := make([]float64, 3)
	seen := [3]bool{}
	for i, o := range q.Observations {
		if o.Zone < 1 || o.Zone > 3 || seen[o.Zone-1] || o.Candidate < 1 || o.Candidate > SweepCandidates || !finite(o.InnerAngle) || !finite(o.OuterAngle) || math.Abs(o.InnerAngle) > 360 || math.Abs(o.OuterAngle) > 360 {
			return nil, errors.New("use groups 1–3 once each, strips 1–21, and angles between -360 and 360 degrees")
		}
		seen[o.Zone-1] = true
		bands[i] = plan.Bands[(o.Zone-1)*SweepCandidates+o.Candidate-1]
		measured[i] = math.Remainder((o.OuterAngle-o.InnerAngle)*math.Pi/180, 2*math.Pi)
		if math.Abs(measured[i]) > 2*math.Pi/3 {
			return nil, errors.New("choose a less-winding strip: the same edge must turn less than 120 degrees with no complete turns")
		}
	}
	evaluate := func(x []float64) ([]float64, float64) {
		c := plan.Geometry
		c.Inner += x[0]
		c.Outer += x[1]
		if math.Abs(x[0]) > .5 || math.Abs(x[1]) > .5 {
			return nil, math.Inf(1)
		}
		g, e := NewGeometry(c)
		if e != nil {
			return nil, math.Inf(1)
		}
		residual := make([]float64, 3)
		cost := 0.0
		for i, b := range bands {
			residual[i] = sweepDrift(source, g, b) - measured[i]
			cost += residual[i] * residual[i]
		}
		return residual, cost
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
				return nil, errors.New("sweep fit reached its radius search boundary")
			}
			jac[j] = make([]float64, 3)
			for i := 0; i < 3; i++ {
				jac[j][i] = (next[i] - res[i]) / 1e-5
			}
		}
		a := [][]float64{{0, 0}, {0, 0}}
		b := []float64{0, 0}
		for j := 0; j < 2; j++ {
			for i := 0; i < 3; i++ {
				b[j] -= jac[j][i] * res[i]
				for k := 0; k < 2; k++ {
					a[j][k] += jac[j][i] * jac[k][i]
				}
			}
			a[j][j] += lambda * math.Max(a[j][j], 1e-12)
		}
		delta, ok := solveLinear(a, b)
		if !ok {
			return nil, errors.New("sweep measurements cannot constrain both radii")
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
		return nil, errors.New("sweep fit reached the ±0.5 mm radius limit; recheck coarse measurements")
	}
	c := plan.Geometry
	c.Inner += x[0]
	c.Outer += x[1]
	result := &SweepFitResult{Geometry: c, RMSDegrees: math.Sqrt(cost/3) * 180 / math.Pi, Warnings: []string{"Radius refinement only: pitch shape and channel-bit length stay fixed. Verify with a new triangle or line burn before artwork.", "A low residual cannot detect skipped full turns or a wrong strip number. Check all three short edges against the strip map."}}
	for i, o := range q.Observations {
		result.MaxDegrees = math.Max(result.MaxDegrees, math.Abs(res[i])*180/math.Pi)
		result.Readings = append(result.Readings, SweepReading{o.Zone, o.Candidate, measured[i] * 180 / math.Pi, (measured[i] + res[i]) * 180 / math.Pi})
		if o.Candidate == 1 || o.Candidate == SweepCandidates {
			result.Warnings = append(result.Warnings, "An endpoint candidate was selected; the useful correction may be near the sweep range limit.")
		}
	}
	if result.RMSDegrees > 5 || result.MaxDegrees > 8 {
		return nil, errors.New("the three sweep measurements disagree (over 5° RMS or 8° maximum); check strip numbers, continuous edges and photo centre. Pitch variation may require further calibration")
	}
	return result, nil
}
