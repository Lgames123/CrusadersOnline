#!/usr/bin/env python3
"""
tools/analyze_pe.py - Inspects crusaders.exe PE headers, sections, imports, and strings safely.
Extracts non-sensitive structural architecture facts for clean-room reverse-engineering notes.
"""

import struct
import sys
from pathlib import Path

def analyze_pe(exe_path: str):
    p = Path(exe_path)
    if not p.exists():
        print(f"File not found: {exe_path}")
        return

    with open(p, "rb") as f:
        data = f.read()

    # DOS Header
    if data[:2] != b"MZ":
        print("Not a valid MZ executable.")
        return

    pe_offset = struct.unpack_from("<I", data, 0x3C)[0]
    if data[pe_offset:pe_offset+4] != b"PE\x00\x00":
        print("Not a valid PE header.")
        return

    # COFF File Header
    coff_offset = pe_offset + 4
    machine, num_sections, timedate, sym_table, num_syms, opt_hdr_size, characteristics = struct.unpack_from("<HHIIIHH", data, coff_offset)

    machine_str = "Intel 386 (x86 32-bit)" if machine == 0x14C else f"Unknown ({hex(machine)})"

    # Optional Header (Standard Fields)
    opt_offset = coff_offset + 20
    magic = struct.unpack_from("<H", data, opt_offset)[0]
    magic_str = "PE32 (32-bit)" if magic == 0x10B else ("PE32+ (64-bit)" if magic == 0x20B else hex(magic))

    major_linker, minor_linker, code_size, init_data_size, uninit_data_size, entry_point, code_base = struct.unpack_from("<BBIIIII", data, opt_offset + 2)

    # Windows-specific fields
    image_base = struct.unpack_from("<I", data, opt_offset + 28)[0]
    section_align = struct.unpack_from("<I", data, opt_offset + 32)[0]
    file_align = struct.unpack_from("<I", data, opt_offset + 36)[0]
    major_os, minor_os, major_img, minor_img, major_sub, minor_sub = struct.unpack_from("<HHHHHH", data, opt_offset + 40)
    subsystem = struct.unpack_from("<H", data, opt_offset + 68)[0]
    subsystem_str = "Windows GUI" if subsystem == 2 else ("Windows CUI" if subsystem == 3 else str(subsystem))

    # Sections
    sections_offset = opt_offset + opt_hdr_size
    sections = []
    for i in range(num_sections):
        sec_bytes = data[sections_offset + i*40 : sections_offset + (i+1)*40]
        name = sec_bytes[:8].rstrip(b"\x00").decode("latin-1", errors="ignore")
        v_size, v_addr, raw_size, raw_addr, reloc_ptr, line_ptr, reloc_cnt, line_cnt, flags = struct.unpack_from("<IIIIIIHHI", sec_bytes, 8)
        sections.append({
            "name": name,
            "virtual_size": v_size,
            "virtual_address": hex(v_addr),
            "raw_size": raw_size,
            "flags": hex(flags)
        })

    print(f"=== PE ANALYSIS: {p.name} ===")
    print(f"Machine: {machine_str}")
    print(f"Magic: {magic_str}")
    print(f"Linker Version: {major_linker}.{minor_linker}")
    print(f"Entry Point: {hex(entry_point)}")
    print(f"Image Base: {hex(image_base)}")
    print(f"Subsystem: {subsystem_str}")
    print(f"Number of Sections: {num_sections}")
    print("\n--- Sections ---")
    for s in sections:
        print(f"  {s['name']:<10} VSize: {s['virtual_size']:<8} VAddr: {s['virtual_address']:<10} RawSize: {s['raw_size']}")

if __name__ == "__main__":
    target = sys.argv[1] if len(sys.argv) > 1 else "./Crusaders of Might and Magic/crusaders.exe"
    analyze_pe(target)
