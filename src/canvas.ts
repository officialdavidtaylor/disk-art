export type Placement={x:number;y:number;scale:number;rotation:number;mirror:boolean};
export function sampleArtwork():HTMLCanvasElement{
 const c=document.createElement('canvas');c.width=c.height=1600;const x=c.getContext('2d')!;
 x.fillStyle='#f3f1e9';x.fillRect(0,0,1600,1600);
 x.strokeStyle='#242722';x.lineWidth=13;
 // An original, vector-drawn contour study. No external image requests.
 for(let i=0;i<50;i++){
  x.beginPath();
  for(let j=0;j<=300;j++){
   const a=j/300*Math.PI*2;
   const r=65+i*18+45*Math.sin(3*a+i*.07)+23*Math.cos(2*a-i*.14);
   const px=800+Math.cos(a)*r,py=800+Math.sin(a)*r*.88;
   if(j===0)x.moveTo(px,py);else x.lineTo(px,py);
  }
  x.closePath();x.stroke();
 }
 return c;
}
export function compose(image:CanvasImageSource,width:number,height:number,p:Placement,size:number){
 const canvas=document.createElement('canvas');canvas.width=canvas.height=size;
 const ctx=canvas.getContext('2d',{willReadFrequently:true})!;ctx.fillStyle='#ffffff';ctx.fillRect(0,0,size,size);
 ctx.translate(size/2+p.x*size/100,size/2+p.y*size/100);
 ctx.rotate(p.rotation*Math.PI/180);ctx.scale(p.mirror?-1:1,1);
 const fit=size/Math.max(width,height)*p.scale;
 ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';ctx.drawImage(image,-width*fit/2,-height*fit/2,width*fit,height*fit);
 return ctx.getImageData(0,0,size,size);
}
export function paintGray(canvas:HTMLCanvasElement,gray:Uint8Array,size:number,physical:boolean){
 canvas.width=canvas.height=size;const ctx=canvas.getContext('2d')!;const image=ctx.createImageData(size,size);
 for(let i=0;i<gray.length;i++){const v=gray[i]===0?(physical?[53,58,53]:[25,27,25]):(physical?[210,211,195]:[250,249,244]);image.data.set([...v,255],i*4)}
 ctx.putImageData(image,0,0);
}
