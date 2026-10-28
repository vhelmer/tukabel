#!/usr/bin/env python3
"""Reproduce local facial warps from original RGB. No synthesis, network or models."""
from PIL import Image, ImageDraw
from pathlib import Path
import json, math, hashlib, argparse
ROOT=Path(__file__).resolve().parent
CFG=json.loads((ROOT/'config.json').read_text())
SOURCE=ROOT/'source.png'
assert hashlib.sha256(SOURCE.read_bytes()).hexdigest()==CFG['sourceHash']
SRC=Image.open(SOURCE).convert('RGBA'); W,H=SRC.size

def sample(x,y):
 x=max(0,min(W-1.001,x)); y=max(0,min(H-1.001,y))
 ix,iy=int(x),int(y);fx,fy=x-ix,y-iy
 pts=[SRC.getpixel((ix,iy)),SRC.getpixel((ix+1,iy)),SRC.getpixel((ix,iy+1)),SRC.getpixel((ix+1,iy+1))]
 return tuple(round(pts[0][k]*(1-fx)*(1-fy)+pts[1][k]*fx*(1-fy)+pts[2][k]*(1-fx)*fy+pts[3][k]*fx*fy) for k in range(3))

def interpolate(x,points):
 if x<=points[0][0]:return points[0][1]
 for (a,b),(c,d) in zip(points,points[1:]):
  if x<=c:return b+(d-b)*(x-a)/(c-a)
 return points[-1][1]

def blink(amount):
 if amount==0:return SRC.copy()
 out=SRC.copy()
 for eye in CFG['eyes']:
  left,right=eye['top'][0][0],eye['top'][-1][0]
  for y in range(math.floor(min(p[1] for p in eye['top']))-1,math.ceil(max(p[1] for p in eye['bottom']))+2):
   for x in range(math.floor(left),math.ceil(right)+1):
    top=interpolate(x,eye['top']);bottom=interpolate(x,eye['bottom'])
    if y<top or y>bottom or x<=left or x>=right:continue
    span=bottom-top
    if span<=0:continue
    # The upper lid descends, preserving the existing lower lash. The lid uses
    # original adjacent skin, including its native shading and grain.
    taper=math.sin(math.pi*(x-left)/(right-left))**.35
    newtop=top+(span-1.0)*amount*taper
    if amount==1:
     if y<bottom-1.2:rgb=sample(x,eye['skinY']+(y-top)*.10)
     else:
      # Reuse the darkest original lower-lash RGB; remove residual white globe.
      candidates=[sample(x,bottom+d) for d in [-1.0,-.5,0,.5,1.0]]
      rgb=min(candidates,key=lambda c:sum(c))
    elif y<newtop:
     rgb=sample(x,eye['skinY']+(y-top)*.10)
    else:
     source_y=top+(y-newtop)*span/max(1,bottom-newtop)
     rgb=sample(x,source_y)
    out.putpixel((x,y),rgb+(SRC.getpixel((x,y))[3],))
 return out

def talk(vertical,horizontal):
 if vertical==1 and horizontal==1:return SRC.copy()
 out=SRC.copy(); mouth=CFG['mouth'];cx,cy=mouth['center'];rx,ry=mouth['radius']
 for y in range(math.floor(cy-ry),math.ceil(cy+ry)+1):
  for x in range(math.floor(cx-rx),math.ceil(cx+rx)+1):
   u,v=(x-cx)/rx,(y-cy)/ry;dist=u*u+v*v
   if dist>=1:continue
   weight=min(1,(1-dist)*2.5)
   sx=cx+(x-cx)/(1+(horizontal-1)*weight)
   slope=mouth.get('slope',0);curve=mouth.get('curve',0)
   baseline=cy+(x-cx)*slope+curve*(x-cx)**2
   top=baseline-mouth.get('apertureAbove',2.5)
   bottom=baseline+mouth.get('apertureBelow',2)
   factor=1+(vertical-1)*max(0,1-u*u)**.7
   newbottom=top+(bottom-top)*factor
   anchor=cy+ry
   if y<=top:sy=y
   elif y<=newbottom:sy=top+(y-top)/factor
   else:sy=bottom+(y-newbottom)*(anchor-bottom)/max(1,anchor-newbottom)
   sy=y+(sy-y)*weight
   out.putpixel((x,y),sample(sx,sy)+(SRC.getpixel((x,y))[3],))
 return out

def frames():
 return {'blink':[blink(a) for a in [0,.55,1,.26,0]],'talk':[SRC.copy(),talk(1.60,1),talk(.55,1.08),talk(1.35,.78),talk(.16,.98)]}

def audit(allframes):
 summary={'sourceHash':CFG['sourceHash'],'sourceAsset':CFG['sourceAsset'],'canvas':[W,H],'sourceAlphaExact':True,'blinkEndpointsExact':True,'outsideFacialRegionsExact':True,'method':'Original RGB bilinear local warp; eyelid fill sampled from original adjacent skin. No provider/API.'}
 regions={}
 for kind,ims in allframes.items():
  xs=[];ys=[];uniques=set()
  for im in ims:
   assert im.size==SRC.size and im.getchannel('A').tobytes()==SRC.getchannel('A').tobytes()
   uniques.add(hashlib.sha256(im.tobytes()).hexdigest())
   for y in range(H):
    for x in range(W):
     if im.getpixel((x,y))!=SRC.getpixel((x,y)):xs.append(x);ys.append(y)
  assert xs
  regions[kind]={'x':min(xs),'y':min(ys),'width':max(xs)-min(xs)+1,'height':max(ys)-min(ys)+1}
  summary[kind]={'region':regions[kind],'uniqueFrames':len(uniques),'changedPixelsUnion':len(set(zip(xs,ys)))}
 assert allframes['blink'][0].tobytes()==SRC.tobytes()==allframes['blink'][-1].tobytes()
 assert summary['blink']['uniqueFrames']==4 and summary['talk']['uniqueFrames']==5
 a,b=regions['blink'],regions['talk'];assert a['y']+a['height']<=b['y'] or b['y']+b['height']<=a['y']
 for kind,ims in allframes.items():
  r=regions[kind]
  for im in ims:
   for y in range(H):
    for x in range(W):
     if not (r['x']<=x<r['x']+r['width'] and r['y']<=y<r['y']+r['height']):assert im.getpixel((x,y))==SRC.getpixel((x,y))
 summary['regionsDisjoint']=True
 return summary

def review(allframes):
 box=CFG['reviewBox'];scale=6;tw=(box[2]-box[0])*scale;th=(box[3]-box[1])*scale
 sheet=Image.new('RGB',(tw*5,(th+22)*2),(82,82,82));d=ImageDraw.Draw(sheet)
 for row,kind in enumerate(['blink','talk']):
  for i,im in enumerate(allframes[kind]):
   face=im.crop(box).resize((tw,th),Image.Resampling.NEAREST)
   tile=Image.new('RGBA',face.size,(160,160,160,255));tile.alpha_composite(face)
   sheet.paste(tile.convert('RGB'),(tw*i,(th+22)*row+22));d.text((tw*i+5,(th+22)*row+4),f'{kind} {i+1}',fill='white')
 sheet.save(ROOT/'contact-sheet.png')

def main():
 parser=argparse.ArgumentParser();parser.add_argument('--kind',choices=['blink','talk']);args=parser.parse_args()
 allframes=frames();validation=audit(allframes)
 (ROOT/'audit.json').write_text(json.dumps(validation,indent=2)+'\n');review(allframes)
 if args.kind:
  for i,im in enumerate(allframes[args.kind],1):im.save(ROOT/f'frame-{i:03d}.png')
 else:
  for kind,ims in allframes.items():
   for i,im in enumerate(ims,1):im.save(ROOT/f'{kind}-{i:02d}.png')
 print(json.dumps(validation))
if __name__=='__main__':main()
