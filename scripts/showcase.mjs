import {mkdir,readFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=new URL('../',import.meta.url);
// Some environments (bare node spawns) lack /opt/homebrew/bin on PATH.
const FFMPEG=process.env.FFMPEG_PATH??['ffmpeg','/opt/homebrew/bin/ffmpeg','/usr/local/bin/ffmpeg'].find(path=>{try{execFileSync(path,['-version'],{stdio:'ignore'});return true;}catch{return false;}});
if (!FFMPEG) throw new Error('ffmpeg is required to build the showcase GIF');
const source=new URL('evidence/current/live-cycle.webm',root);
await readFile(source); // Require a real app recording, never manufacture the artwork.
await mkdir(new URL('media/',root),{recursive:true});
const out=new URL('media/living-ukiyoe.gif',root);
// Source: the e2e canvas recording — closed paper → full part-by-part
// entrance → the first five seconds of the steady loop, then the GIF restarts.
// The compact GIF is a presentation export at 480px / 6fps; the runtime retains
// the full approved texture data.
execFileSync(FFMPEG,['-v','error','-y','-ss','0.2','-i',fileURLToPath(source),'-t','6.5','-filter_complex','fps=6,scale=480:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=96[p];[b][p]paletteuse=dither=bayer:bayer_scale=4','-loop','0',fileURLToPath(out)],{stdio:'inherit'});
console.log('Rebuilt media/living-ukiyoe.gif from the production browser canvas.');
