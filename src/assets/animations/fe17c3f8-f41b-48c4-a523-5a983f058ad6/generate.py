"""Reproducible local facial sprites. Original RGBA is unchanged outside compact facial masks."""
from PIL import Image,ImageDraw,ImageChops
import json,math,hashlib,sys
from pathlib import Path
ID='priest'
ROOT=Path(__file__).resolve().parent
src=Image.open(ROOT/'source.png').convert('RGBA');W,H=src.size;out=ROOT/'reproduced';out.mkdir(exist_ok=True)
source='source.png';root=ROOT
if ID=='priest':
 eyes=[(87.5,29,6,4,(125,79,46)),(103,28.5,4.5,3.5,(134,85,49))];mouth=(96,49.5,10,5,-.04);face=(70,12,116,66)
else:
 eyes=[(203,37,8,9,(173,93,50)),(226.5,49.5,5.5,6,(198,125,76))];mouth=(194,75,23,11,.36);face=(164,20,239,100)

def mask_ellipse(cx,cy,rx,ry):
 m=Image.new('L',(W*4,H*4));ImageDraw.Draw(m).ellipse(((cx-rx)*4,(cy-ry)*4,(cx+rx)*4,(cy+ry)*4),fill=255);return m.resize((W,H),Image.Resampling.LANCZOS)
def sample(x,y):
 x=max(0,min(W-1.001,x));y=max(0,min(H-1.001,y));ix=int(x);iy=int(y);fx=x-ix;fy=y-iy;p=src.load();return tuple(round(p[ix,iy][k]*(1-fx)*(1-fy)+p[ix+1,iy][k]*fx*(1-fy)+p[ix,iy+1][k]*(1-fx)*fy+p[ix+1,iy+1][k]*fx*fy) for k in range(4))
def blink(amount):
 if not amount:return src.copy()
 im=src.copy()
 for cx,cy,rx,ry,skin in eyes:
  mask=mask_ellipse(cx,cy,rx,ry);paint=src.copy();pixels=paint.load()
  for y in range(max(0,int(cy-ry-2)),min(H,int(cy+ry+3))):
   for x in range(max(0,int(cx-rx-2)),min(W,int(cx+rx+3))):
    if mask.getpixel((x,y)):
     # Compress the original globe vertically as the lid closes; shade is sampled
     # from the same character and the original lower/outer eyelid stays anchored.
     newtop=cy-ry+2*ry*amount*.8
     if y>=newtop and amount<.96:pixels[x,y]=sample(x,cy-ry+(y-newtop)/max(.12,1-amount*.8))
     else:
      noise=math.sin(x*1.9+y*1.3)*1.2;shade=(y-cy)*.7
      pixels[x,y]=tuple(max(0,min(255,round(c-shade+noise))) for c in skin)+(255,)
  ink=Image.new('RGBA',(W*4,H*4));d=ImageDraw.Draw(ink);mid=cy-ry+2*ry*amount*.8
  pts=[]
  for i in range(25):
   u=-1+2*i/24;yy=cy+(mid-cy)*(1-u*u)+.7*(1-u*u)
   pts.append(((cx+u*rx)*4,yy*4))
  d.line(pts,fill=(48,30,21,235),width=3,joint='curve');ink=ink.resize((W,H),Image.Resampling.LANCZOS);ink.putalpha(ImageChops.multiply(ink.getchannel('A'),mask));paint=Image.alpha_composite(paint,ink);im=Image.composite(paint,im,mask)
 im.putalpha(src.getchannel('A'));return im

def talk(sx,sy,aperture=0):
 if sx==sy==1 and aperture==0:return src.copy()
 cx,cy,rx,ry,a=mouth;ca=math.cos(a);sa=math.sin(a);paint=src.copy();p=paint.load();mask=Image.new('L',(W,H));m=mask.load()
 for y in range(max(0,int(cy-ry-rx*abs(sa)-3)),min(H,int(cy+ry+rx*abs(sa)+4))):
  for x in range(max(0,int(cx-rx-3)),min(W,int(cx+rx+4))):
   u=(x-cx)*ca+(y-cy)*sa;v=-(x-cx)*sa+(y-cy)*ca;r=(u/rx)**2+(v/ry)**2
   if r<1:
    f=min(1,(1-r)*3);su=u/(1+(sx-1)*f);sv=v/(1+(sy-1)*f);p[x,y]=sample(cx+su*ca-sv*sa,cy+su*sa+sv*ca);m[x,y]=255
 im=Image.composite(paint,src,mask)
 if aperture:
  # Only the priest starts with fully closed lips: add a small shaded opening
  # below the untouched moustache, bounded inside the original lip/chin area.
  hi=Image.new('RGBA',(W*4,H*4));d=ImageDraw.Draw(hi);rrx=5.5*sx;rry=aperture
  d.ellipse(((cx-rrx)*4,(cy-rry)*4,(cx+rrx)*4,(cy+rry)*4),fill=(47,30,22,255),outline=(87,48,30,245),width=2)
  d.arc(((cx-rrx)*4,(cy-rry)*4,(cx+rrx)*4,(cy+rry)*4),0,180,fill=(148,89,57,235),width=3)
  hi=hi.resize((W,H),Image.Resampling.LANCZOS);hi.putalpha(ImageChops.multiply(hi.getchannel('A'),mask));im=Image.alpha_composite(im,hi)
 im.putalpha(src.getchannel('A'));return im
frames={'blink':[blink(a) for a in [0,.55,1,.28,0]],'talk':([src.copy(),talk(1,1.2,1.2),talk(1.12,1.35,2),talk(.7,1.4,2.3),talk(.9,.72,.4)] if ID=='priest' else [src.copy(),talk(1.05,1.3),talk(1.1,.55),talk(.72,1.15),talk(.9,.42)])}
regions={};audit={};raw=src.tobytes();sets={}
for kind,seq in frames.items():
 changed=set();unique=set()
 for i,im in enumerate(seq):
  assert im.size==src.size and im.getchannel('A').tobytes()==src.getchannel('A').tobytes()
  b=im.tobytes();unique.add(hashlib.sha256(b).hexdigest());changed.update(p for p in range(W*H) if b[4*p:4*p+4]!=raw[4*p:4*p+4]);im.save(out/f'{kind}-{i+1:02}.png')
 xs=[p%W for p in changed];ys=[p//W for p in changed];regions[kind]={'x':min(xs),'y':min(ys),'width':max(xs)-min(xs)+1,'height':max(ys)-min(ys)+1};sets[kind]=changed;audit[kind]={'uniqueFrames':len(unique),'changedPixels':len(changed),'region':regions[kind]}
assert not sets['blink']&sets['talk'];assert frames['blink'][0].tobytes()==raw==frames['blink'][-1].tobytes();assert audit['blink']['uniqueFrames']==4 and audit['talk']['uniqueFrames']==5
assert regions['blink']['y']+regions['blink']['height']<=regions['talk']['y']
sheet=Image.new('RGB',(5*240,2*320),(70,70,70));d=ImageDraw.Draw(sheet)
for row,(kind,seq) in enumerate(frames.items()):
 for i,im in enumerate(seq):
  crop=im.crop(face);crop.thumbnail((230,285));crop=im.crop(face).resize((230,285),Image.Resampling.NEAREST);bg=Image.new('RGBA',crop.size,(170,170,170));bg.alpha_composite(crop);sheet.paste(bg.convert('RGB'),(i*240,row*320+20));d.text((i*240+3,row*320+3),f'{kind} {i+1}',fill='white')
sheet.save(out/'contact-sheet.png');src.save(out/'source.png');json.dump({'source':source,'sourceSha256':hashlib.sha256((root/source).read_bytes()).hexdigest(),'alphaExact':True,'outsideRegionsExact':True,'audit':audit},open(out/'audit.json','w'),indent=2)
print(ID,json.dumps(audit))
