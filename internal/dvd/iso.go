// SPDX-License-Identifier: GPL-3.0-or-later
package dvd

import "encoding/binary"

const Readme = "DVD ART\r\n\r\nThis disc is a visual artwork on the recording surface.\r\nIt contains no video, audio, program, or user data.\r\nUnallocated sectors hold the artwork texture.\r\n\r\nhttps://dvd-art.emfsoft.com\r\n"
const Shortcut = "[InternetShortcut]\r\nURL=https://dvd-art.emfsoft.com\r\n"

func both16(b []byte, v uint16) {
	binary.LittleEndian.PutUint16(b, v)
	binary.BigEndian.PutUint16(b[2:], v)
}
func both32(b []byte, v uint32) {
	binary.LittleEndian.PutUint32(b, v)
	binary.BigEndian.PutUint32(b[4:], v)
}
func record(name []byte, extent, size uint32, dir bool) []byte {
	n := 33 + len(name)
	if n%2 != 0 {
		n++
	}
	r := make([]byte, n)
	r[0] = byte(n)
	both32(r[2:], extent)
	both32(r[10:], size)
	copy(r[18:], []byte{126, 11, 6, 0, 0, 0, 0})
	if dir {
		r[25] = 2
	}
	both16(r[28:], 1)
	r[32] = byte(len(name))
	copy(r[33:], name)
	return r
}
func padded(b []byte, s string) {
	for i := range b {
		b[i] = ' '
	}
	copy(b, s)
}

// Only 32 sectors (64 KiB) are reserved. The artwork is deliberately not a
// directory entry, so readers do not interpret the payload as audio or video.
func ISOPrefix(sectors uint32) []byte {
	out := make([]byte, MetadataSectors*SectorBytes)
	p := out[16*SectorBytes : 17*SectorBytes]
	p[0] = 1
	copy(p[1:], "CD001")
	p[6] = 1
	padded(p[8:40], "DVD_ART")
	padded(p[40:72], "DVD_ART")
	both32(p[80:], sectors)
	both16(p[120:], 1)
	both16(p[124:], 1)
	both16(p[128:], SectorBytes)
	both32(p[132:], 10)
	binary.LittleEndian.PutUint32(p[140:], 18)
	binary.BigEndian.PutUint32(p[148:], 19)
	copy(p[156:], record([]byte{0}, 20, SectorBytes, true))
	padded(p[190:318], "")
	padded(p[318:446], "EMFSOFT")
	padded(p[446:574], "DVD ART")
	padded(p[574:702], "DVD ART BROWSER ENCODER")
	for _, o := range []int{813, 830} {
		copy(p[o:], []byte("2026110600000000"))
		p[o+16] = 0
	}
	for _, o := range []int{847, 864} {
		copy(p[o:], []byte("0000000000000000"))
		p[o+16] = 0
	}
	p[881] = 1
	term := out[17*SectorBytes:]
	term[0] = 255
	copy(term[1:], "CD001")
	term[6] = 1
	for _, lba := range []int{18, 19} {
		t := out[lba*SectorBytes:]
		t[0] = 1
		if lba == 18 {
			binary.LittleEndian.PutUint32(t[2:], 20)
			binary.LittleEndian.PutUint16(t[6:], 1)
		} else {
			binary.BigEndian.PutUint32(t[2:], 20)
			binary.BigEndian.PutUint16(t[6:], 1)
		}
	}
	root := out[20*SectorBytes : 21*SectorBytes]
	offset := 0
	for _, r := range [][]byte{record([]byte{0}, 20, SectorBytes, true), record([]byte{1}, 20, SectorBytes, true), record([]byte("README.TXT;1"), 21, uint32(len(Readme)), false), record([]byte("WEBSITE.URL;1"), 22, uint32(len(Shortcut)), false)} {
		copy(root[offset:], r)
		offset += len(r)
	}
	copy(out[21*SectorBytes:], Readme)
	copy(out[22*SectorBytes:], Shortcut)
	return out
}
