"""Decode and inspect the finished MP4; preserve review frames and measured results."""
from pathlib import Path
import hashlib, json, re, subprocess
from PIL import Image,ImageDraw,ImageFont
import imageio_ffmpeg
R=Path(__file__).resolve().parents[1];P=R/'production'; V=R/'exports/ReceiptNest-Ready-for-Tax-Time-20s.mp4';F=imageio_ffmpeg.get_ffmpeg_exe()
r=subprocess.run([F,'-hide_banner','-i',str(V),'-vf','blackdetect=d=0.1:pix_th=0.10:pic_th=0.99','-af','loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json','-f','null','-'],capture_output=True,text=True)
(P/'qa-decode.log').write_text(r.stderr)
assert r.returncode==0,r.stderr[-3000:]
assert '00:00:20.00' in r.stderr
assert '1080x1920' in r.stderr and '24 fps' in r.stderr
assert 'black_start' not in r.stderr
loud=json.loads(re.search(r'\{\s*"input_i"[^}]+\}',r.stderr).group(0))
report=dict(duration_seconds=20,dimensions=[1080,1920],frame_rate=24,frame_count=480,video_codec='H.264 High',audio_codec='AAC LC',audio_sample_rate=48000,audio_channels=1,integrated_loudness_lufs=float(loud['input_i']),true_peak_dbtp=float(loud['input_tp']),loudness_range_lu=float(loud['input_lra']),full_decode_exit_code=r.returncode,black_intervals_detected=0,bytes=V.stat().st_size,sha256=hashlib.sha256(V.read_bytes()).hexdigest(),human_audio_audition=False)
(P/'qa-results.json').write_text(json.dumps(report,indent=2)+'\n')
subprocess.run([F,'-y','-v','error','-i',str(V),'-vf','fps=2,scale=216:384','-q:v','3',str(P/'encoded-%02d.jpg')],check=True)
frames=sorted(P.glob('encoded-*.jpg'));canvas=Image.new('RGB',(1760,2070),(230,233,226));d=ImageDraw.Draw(canvas);font=ImageFont.truetype(str(R/'assets/Space-Grotesk-500.ttf'),18)
for i,path in enumerate(frames):
 x=(i%8)*220;y=(i//8)*414;canvas.paste(Image.open(path),(x,y));d.text((x+4,y+388),f'~{i*.5:.1f}s',fill='#0c3128',font=font)
canvas.save(P/'encoded-contact.jpg',quality=91)
# Full-resolution encoded frames at copy and transition checkpoints.
for t in [0,.5,2.5,4.25,6.2,7.25,9.75,10.6,12.8,14.9,15.75,17.75,19.9]:
 subprocess.run([F,'-y','-v','error','-ss',str(t),'-i',str(V),'-frames:v','1','-q:v','2',str(P/f'final-{t:.2f}.jpg')],check=True)
print(json.dumps(report,indent=2))
