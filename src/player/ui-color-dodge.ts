// Torappu/UI/BlendMode/ColorDodge: four threshold passes followed by the
// authored log-polynomial remainder. Each pass blends DstColor, One.
// Retain the individual render-target writes; one floating-point formula
// would lose the original UNORM rounding between passes.
export const colorDodgeUIProgram = `
vec4 t=texture(tex0,uv*cb[2].xy+cb[2].zw);
float a=t.a*tint.a*cb[3].x;
if(alphaClip&&a<.001)discard;
vec3 v=vec3(a)/(vec3(1.)-t.rgb*tint.rgb)-vec3(a);
if(dodgePass<4){frag=vec4(vec3(greaterThanEqual(v,vec3(exp2(float(dodgePass+1))-1.))),a);}
else{v=log2(v+vec3(1.));v=max(v-vec3(4.),fract(v));frag=vec4(v*(v*.3443+.6557),a);}
`;
