import { ImageResponse } from "next/og";

export const size = { width: 32, height: 32 };
export const contentType = "image/png";

// Two overlapping discs — a small nod to vinyl/record shopping, doubling as
// a stand-in for "search" (the overlap reads like a magnifying glass at
// this size). Kept to the brand accent on a dark chip so it stays legible
// as a browser-tab favicon in both light and dark tab bars.
export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#171717",
          borderRadius: 7,
        }}
      >
        <svg width="20" height="20" viewBox="0 0 20 20">
          <circle cx="8" cy="10" r="6.5" fill="none" stroke="#8b7cf6" strokeWidth="2" />
          <circle cx="13" cy="10" r="6.5" fill="none" stroke="#f5f5f5" strokeWidth="2" />
        </svg>
      </div>
    ),
    { ...size }
  );
}
