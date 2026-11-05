// Acornary D-refined 20px line mark, exported from Figma node 133:388.
// Source: assets/brand/refined-d/line/acornary-line-20-{light,dark}.svg.
// Embed the geometry so the runtime image does not need the design asset tree.
function iconSource(stroke: string) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="${stroke}" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round">
  <path d="M3.06236 6.93742C2.87486 5.93742 3.99986 4.43742 5.68736 3.49992L5.24986 2.74992C5.06236 2.43742 6.06236 1.99992 6.49986 2.12492L6.81236 3.06242C8.93736 2.68742 10.9999 3.74992 11.6249 5.06242C8.62486 4.81242 5.62486 5.62492 3.06236 6.93742Z"/>
  <path d="M3.56234 8.31237C2.99984 10.3749 3.81234 13.3749 5.87484 15.4374C7.68734 17.3749 11.0623 17.8124 13.3748 16.3749C14.3123 15.7499 14.7498 14.7499 14.9998 13.5624C15.2498 12.3124 15.4998 11.6874 16.3748 11.2499C17.0623 10.8749 17.1248 10.6249 16.8123 10.3124C16.3748 9.81238 15.7498 9.31237 15.1248 9.12487C14.8748 8.62487 14.4373 7.99988 14.0623 7.62488C13.7498 7.31238 13.5623 7.62488 13.4998 8.12488L13.3123 9.06238C12.7498 10.1874 12.0623 10.8124 11.1873 11.4999"/>
  <path d="M3.5625 8.3125C5.6875 7.0625 8.4375 6.4375 10.5625 6.4375C11.375 6.4375 11.625 6.8125 11.5 7.5C11.25 8.875 9.625 10.125 9.125 11.6875C8.6875 13.0625 9.0625 14.3125 10.0625 15.125"/>
</svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}

export const inventoryIcons = [
  {
    src: iconSource('#68615C'),
    mimeType: 'image/svg+xml',
    sizes: ['any'],
    theme: 'light' as const,
  },
  {
    src: iconSource('#A6A49E'),
    mimeType: 'image/svg+xml',
    sizes: ['any'],
    theme: 'dark' as const,
  },
];
