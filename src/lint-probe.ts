export function leak(area: { metadata: { lat: number } }) {
  return area.metadata.lat;
}
