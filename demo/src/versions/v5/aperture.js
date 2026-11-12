// The frozen Demo's aperture, reduced to the only rule the final default
// picture needs: never draw pigment outside the print's 18px trim.
// Verbatim JS port of the Radio theme's `aperture.ts`.
export const APERTURE = /* glsl */ `
varying vec2 artPoint;

bool outsidePrint() {
  return artPoint.x < 18.0 || artPoint.x > 1382.0
    || artPoint.y < 18.0 || artPoint.y > 943.0;
}
`;
