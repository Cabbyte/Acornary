# Responsive Workbench assets

Unmodified SVG exports from the Acornary Figma file `Xt5Dcp0NHtYPC0UbSF3iHO`, page `128:358`.
Source frames: desktop `136:361`, move `136:370`, mobile `136:374`, mobile detail `136:375`.
These are navigation and control assets; physical item rows intentionally have no thumbnail or item icon.

| File             | Native dimensions | Design slot / rendered dimensions                                                             |
| ---------------- | ----------------- | --------------------------------------------------------------------------------------------- |
| brand.svg        | 15.3388 × 15.6194 | Brand mark inside a 40px desktop / 32px mobile wrapper, scaled with its original aspect ratio |
| items.svg        | 24 × 24           | Main navigation 18px / mobile tab 24px                                                        |
| catalog.svg      | 24 × 24           | Main navigation 18px / mobile tab 24px                                                        |
| settings.svg     | 24 × 24           | Main navigation 18px / mobile tab 24px                                                        |
| folder.svg       | 24 × 24           | Location tree / child locations 16px                                                          |
| chevron.svg      | 24 × 24           | Tree disclosure 12px, rotated on expansion                                                    |
| plus.svg         | 24 × 24           | New location control 18px                                                                     |
| search.svg       | 20 × 20           | Global, local and location search 20px                                                        |
| down.svg         | 12 × 12           | Household disclosure 12px                                                                     |
| close.svg        | 24 × 24           | Inspector close 18px / search clear 16px                                                      |
| dots.svg         | 24 × 24           | Mobile inspector more control 18px                                                            |
| status.svg       | 6 × 6             | Inspector state 6px / mobile list state 5px                                                   |
| status-muted.svg | 5 × 5             | Mobile list secondary state 5px                                                               |
| check.svg        | 16 × 16           | Selected native checkbox background 16px                                                      |

`WorkbenchIcon` retains intrinsic SVG dimensions and scales the image using a transform within its design slot. No SVG paths or root dimensions are modified. All files are local and are included in the service worker's precache. Vite also bundles their original bytes as data URLs for the shared web and opaque MCP Apps runtime; no external image host is needed. The control markup and styling live in `ui/workbench.tsx` and `workbench.css`.
