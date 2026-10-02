"""List every HID interface of a device with its strings and report sizes (Windows).

  python tools/hid_list.py 258A 0036
"""
import ctypes
import sys
from ctypes import wintypes

import hid


class HIDP_CAPS(ctypes.Structure):
    _fields_ = [("Usage", wintypes.USHORT), ("UsagePage", wintypes.USHORT),
                ("InputReportByteLength", wintypes.USHORT), ("OutputReportByteLength", wintypes.USHORT),
                ("FeatureReportByteLength", wintypes.USHORT), ("Reserved", wintypes.USHORT * 17),
                ("Rest", wintypes.USHORT * 10)]


k32 = ctypes.WinDLL("kernel32", use_last_error=True)
hidlib = ctypes.WinDLL("hid")
k32.CreateFileW.restype = wintypes.HANDLE

vid, pid = (int(a, 16) for a in sys.argv[1:3])
for d in hid.enumerate(vid, pid):
    path = d["path"].decode()
    h = k32.CreateFileW(path, 0, 3, None, 3, 0, None)
    ppd = ctypes.c_void_p()
    caps = HIDP_CAPS()
    if hidlib.HidD_GetPreparsedData(h, ctypes.byref(ppd)):
        hidlib.HidP_GetCaps(ppd, ctypes.byref(caps))
        hidlib.HidD_FreePreparsedData(ppd)
    k32.CloseHandle(h)
    col = path.upper().split("&COL")[1][:2] if "&COL" in path.upper() else "--"
    print(f"if={d['interface_number']} col={col} page=0x{d['usage_page']:04X} usage=0x{d['usage']:02X} "
          f"in={caps.InputReportByteLength} out={caps.OutputReportByteLength} feat={caps.FeatureReportByteLength} "
          f"| {d['manufacturer_string']!r} {d['product_string']!r}")
