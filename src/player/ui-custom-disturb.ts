// Torappu/UI/Disturb(CustomData), no-keyword variant. The original VS
// generates four affine UV streams; disabled CustomData contributes (0,0).
export const customDisturbVaryings = 'out vec4 effectUV;out vec4 effectAux;';
export const customDisturbVertex = `
vec2 a=texcoord*cb[8].xy+cb[8].zw;
vec2 b=texcoord*cb[9].xy+cb[9].zw;
vec2 c=texcoord*cb[10].xy+cb[10].zw;
vec2 d=texcoord*cb[11].xy+cb[11].zw;
if(cb[2].x>.5){a=(a.x-.5)*cb[3].xy+(a.y-.5)*cb[3].zw+.5;
b=(b.x-.5)*cb[4].xy+(b.y-.5)*cb[4].zw+.5;
c=(c.x-.5)*cb[6].xy+(c.y-.5)*cb[6].zw+.5;
d=(d.x-.5)*cb[5].xy+(d.y-.5)*cb[5].zw+.5;}
effectUV=vec4(a+fract(cb[13].yz*clock.y),b+fract(cb[14].zw*clock.y));
effectAux=vec4(d,c+fract(cb[15].zw*clock.y));`;
export const customDisturbUIProgram = `
vec2 amount=cb[15].xy*texture(tex1,effectAux.zw).r;
vec2 delta=amount*texture(tex0,effectAux.xy).rg;
vec4 t=texture(tex2,effectUV.xy+delta)*cb[12]*tint;
float mask=texture(tex3,effectUV.zw+cb[13].w*delta).r;
float edge=1.-roundEven(cb[14].x+.5);
float a=clamp((mask-cb[14].x+cb[14].y*edge)/cb[14].y,0.,1.);
frag=vec4(t.rgb*2.,clamp(a*t.a*cb[13].x,0.,1.));
if(frag.a<.001)discard;`;
