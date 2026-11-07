//go:build js && wasm

// SPDX-License-Identifier: GPL-3.0-or-later
package main

import (
	"dvd-art/internal/dvd"
	"encoding/json"
	"syscall/js"
)

var encoder *dvd.Encoder
var callbacks []js.Func

func bind(name string, fn func([]js.Value) any) {
	f := js.FuncOf(func(_ js.Value, a []js.Value) (result any) {
		defer func() {
			if recover() != nil {
				result = map[string]any{"error": "Encoder rejected an invalid request"}
			}
		}()
		return fn(a)
	})
	callbacks = append(callbacks, f)
	js.Global().Set(name, f)
}
func fail(err error) any { return map[string]any{"error": err.Error()} }
func process(a []js.Value) ([]byte, int, error) {
	var tone dvd.Tone
	if err := json.Unmarshal([]byte(a[2].String()), &tone); err != nil {
		return nil, 0, err
	}
	size := a[1].Int()
	data := make([]byte, a[0].Get("byteLength").Int())
	js.CopyBytesToGo(data, a[0])
	gray, err := dvd.Process(data, size, tone)
	return gray, size, err
}
func main() {
	bind("dvdSweepPlan", func(a []js.Value) any {
		var c dvd.Config
		if err := json.Unmarshal([]byte(a[0].String()), &c); err != nil {
			return fail(err)
		}
		result, err := dvd.NewSweepPlan(c)
		if err != nil {
			return fail(err)
		}
		data, err := json.Marshal(result)
		if err != nil {
			return fail(err)
		}
		return string(data)
	})
	bind("dvdSweepFit", func(a []js.Value) any {
		var q dvd.SweepFitRequest
		if err := json.Unmarshal([]byte(a[0].String()), &q); err != nil {
			return fail(err)
		}
		result, err := dvd.FitSweep(q)
		if err != nil {
			return fail(err)
		}
		data, err := json.Marshal(result)
		if err != nil {
			return fail(err)
		}
		return string(data)
	})
	bind("dvdCalibrationStart", func(a []js.Value) any {
		encoder = nil
		var c dvd.Config
		if err := json.Unmarshal([]byte(a[0].String()), &c); err != nil {
			return fail(err)
		}
		var err error
		encoder, err = dvd.NewCalibrationEncoder(c, a[1].String())
		if err != nil {
			return fail(err)
		}
		return true
	})
	bind("dvdCalibrate", func(a []js.Value) any {
		var q dvd.CalibrationRequest
		if err := json.Unmarshal([]byte(a[0].String()), &q); err != nil {
			return fail(err)
		}
		result, err := dvd.Calibrate(q)
		if err != nil {
			return fail(err)
		}
		data, err := json.Marshal(result)
		if err != nil {
			return fail(err)
		}
		return string(data)
	})
	bind("dvdPreview", func(a []js.Value) any {
		gray, _, err := process(a)
		if err != nil {
			return fail(err)
		}
		out := js.Global().Get("Uint8Array").New(len(gray))
		js.CopyBytesToJS(out, gray)
		return out
	})
	bind("dvdStart", func(a []js.Value) any {
		encoder = nil
		gray, size, err := process(a)
		if err != nil {
			return fail(err)
		}
		var c dvd.Config
		if err = json.Unmarshal([]byte(a[3].String()), &c); err != nil {
			return fail(err)
		}
		encoder, err = dvd.NewEncoder(c, gray, size)
		if err != nil {
			return fail(err)
		}
		return true
	})
	bind("dvdChunk", func(a []js.Value) any {
		if encoder == nil {
			return map[string]any{"error": "Encoder is not initialized"}
		}
		start, count := a[0].Int(), a[1].Int()
		if start < 0 || count < 1 || count > 512 {
			return map[string]any{"error": "Invalid chunk size"}
		}
		data := make([]byte, count*dvd.SectorBytes)
		if err := encoder.Fill(uint32(start), data); err != nil {
			return fail(err)
		}
		out := js.Global().Get("Uint8Array").New(len(data))
		js.CopyBytesToJS(out, data)
		return out
	})
	bind("dvdRelease", func(_ []js.Value) any { encoder = nil; return true })
	select {}
}
