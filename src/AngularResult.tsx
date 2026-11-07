import type {BurnRecord,Fit} from './calibration';
const signed=(v:number,digits=6)=>(v>0?'+':'')+v.toFixed(digits);
export default function AngularResult({fit,record}:{fit:Fit;record:BurnRecord}){
 const d=fit.diagnostics;if(!d)return null;
 const points=d.stations;const first=points[0],last=points.at(-1)!;
 const low=Math.min(-.5,...points.map(p=>p.degrees)),high=Math.max(.5,...points.map(p=>p.degrees));
 const x=(r:number)=>52+(r-first.radius)/(last.radius-first.radius)*378;
 const y=(deg:number)=>22+(high-deg)/(high-low)*135;
 const path=points.map((p,i)=>(i?'L':'M')+x(p.radius).toFixed(2)+' '+y(p.degrees).toFixed(2)).join(' ');
 return <div className="angular-analysis">
  <h4>Angular drift across your trace</h4>
  <p className="cal-hint">Fitted spiral error relative to this burn’s frozen geometry. Zero is the first measured radius; photo rotation and the triangle’s own taper are removed. Angles retain every complete turn.</p>
  <div className="angular-metrics"><div><span>Inner → outer drift</span><strong>{signed(d.driftDegrees,2)}°</strong><small>{signed(d.driftDegrees/360,3)} turns</small></div><div><span>Peak-to-peak drift</span><strong>{d.peakToPeakDegrees.toFixed(2)}°</strong><small>Across measured radii</small></div><div><span>Inferred track pitch</span><strong>{d.innerPitchNM.toFixed(2)} → {d.outerPitchNM.toFixed(2)} nm</strong><small>Inner → outer recording radius</small></div></div>
  <svg className="phase-chart" viewBox="0 0 460 205" role="img" aria-label={`Fitted angular error from ${first.radius.toFixed(2)} to ${last.radius.toFixed(2)} millimetres, ending at ${d.driftDegrees.toFixed(2)} degrees.`}>
   <rect x="52" y="22" width="378" height="135" fill="#f8faf4"/>
   {[low,(low+high)/2,high].map(value=><g key={value}><line x1="52" x2="430" y1={y(value)} y2={y(value)} stroke="#d8e0cd"/><text x="44" y={y(value)+3} textAnchor="end">{value.toFixed(1)}°</text></g>)}
   <line x1="52" x2="430" y1={y(0)} y2={y(0)} stroke="#a6b795" strokeDasharray="3 3"/>
   <path d={path} stroke="#cb6846" strokeWidth="2" fill="none"/>
   {[first.radius,(first.radius+last.radius)/2,last.radius].map(r=><text key={r} x={x(r)} y="175" textAnchor="middle">{r.toFixed(2)}</text>)}
   <text x="240" y="195" textAnchor="middle">Measured radius (mm)</text>
  </svg>
  <div className="parameter-table"><table><caption>Corrections to this burn’s geometry</caption><thead><tr><th>Parameter</th><th>Written with</th><th>Fitted</th><th>Change</th></tr></thead><tbody>
   <tr><th>Inner radius (mm)</th><td>{record.geometry.inner.toFixed(6)}</td><td>{fit.geometry.inner.toFixed(6)}</td><td>{signed(d.innerDeltaMM)}</td></tr>
   <tr><th>Outer radius (mm)</th><td>{record.geometry.outer.toFixed(6)}</td><td>{fit.geometry.outer.toFixed(6)}</td><td>{signed(d.outerDeltaMM)}</td></tr>
   {(['pitchLinear','pitchQuadratic','pitchCubic'] as const).map((key,i)=><tr key={key}><th>Pitch {['linear','quadratic','cubic'][i]}</th><td>{record.geometry[key].toExponential(4)}</td><td>{fit.geometry[key].toExponential(4)}</td><td>{(fit.geometry[key]-record.geometry[key]).toExponential(4)}</td></tr>)}
  </tbody></table></div>
  <p className="cal-hint">Photo / chosen-spoke alignment: {signed(d.photoRotationDegrees,2)}°. This is absorbed during fitting; it does not change the start angle. Channel-bit length remains {fit.geometry.bitLength} nm. Mechanical axis displacement and disc wobble cannot be inferred from this fit. Printed decimal places are not measurement accuracy.</p>
 </div>;
}
