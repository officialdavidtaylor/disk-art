// SPDX-License-Identifier: GPL-3.0-or-later
package dvd

import (
	"errors"
	"math"
)

type Tone struct {
	Brightness float64 `json:"brightness"`
	Contrast   float64 `json:"contrast"`
	Gamma      float64 `json:"gamma"`
	Threshold  float64 `json:"threshold"`
	Dither     bool    `json:"dither"`
	Invert     bool    `json:"invert"`
}

func Process(rgba []byte, size int, t Tone) ([]byte, error) {
	if size < 2 || size > 4096 || len(rgba) != size*size*4 {
		return nil, errors.New("invalid image dimensions (maximum 4096 × 4096)")
	}
	for _, v := range []float64{t.Brightness, t.Contrast, t.Gamma, t.Threshold} {
		if math.IsNaN(v) || math.IsInf(v, 0) {
			return nil, errors.New("invalid image tone")
		}
	}
	if t.Gamma < .1 || t.Gamma > 4 || t.Contrast < 0 || t.Contrast > 3 || t.Brightness < -1 || t.Brightness > 1 || t.Threshold < 0 || t.Threshold > 1 {
		return nil, errors.New("image tone is outside the supported range")
	}
	out := make([]byte, size*size)
	current, next := make([]float64, size+2), make([]float64, size+2)
	for y := 0; y < size; y++ {
		direction, start, end := 1, 0, size
		if y%2 == 1 {
			direction, start, end = -1, size-1, -1
		}
		for x := start; x != end; x += direction {
			p := (y*size + x) * 4
			a := float64(rgba[p+3]) / 255
			v := (.2126*float64(rgba[p]) + .7152*float64(rgba[p+1]) + .0722*float64(rgba[p+2])) / 255
			v = v*a + (1 - a)
			v = math.Max(0, math.Min(1, (v-.5)*t.Contrast+.5+t.Brightness))
			v = math.Pow(v, 1/t.Gamma)
			if t.Invert {
				v = 1 - v
			}
			if t.Dither {
				v += current[x+1]
			}
			q := 0.0
			if v >= t.Threshold {
				q = 1
				out[y*size+x] = 255
			}
			if t.Dither {
				e := v - q
				current[x+1+direction] += e * 7 / 16
				next[x+1-direction] += e * 3 / 16
				next[x+1] += e * 5 / 16
				next[x+1+direction] += e / 16
			}
		}
		current, next = next, current
		clear(next)
	}
	return out, nil
}
