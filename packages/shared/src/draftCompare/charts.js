/* Dependency-free browser/standalone renderer. Embedded verbatim in offline kits.
 * No network, scorer, projection inference or draft mutation lives here. */
(function (scope) {
  'use strict';
  const COLORS=['#b84b00','#2563eb','#15803d','#7c3aed','#be123c','#0f766e','#a16207','#4338ca','#a21caf','#475569'];
  const finite=v=>typeof v==='number'&&Number.isFinite(v);
  const value=(p,s,impact)=>finite(p.stats[s.key])?p.stats[s.key]*(impact&&finite(s.weight)?s.weight:1):null;
  const states=new WeakMap();
  function models(players,stats,impact) {
    const weighted=stats.some(s=>finite(s.weight));
    return [false,true].flatMap(goalie=>{
      const cohort=players.filter(p=>p.goalie===goalie);
      if(!cohort.length)return [];
      const enabled=stats.filter(s=>(!s.group||s.group===(goalie?'goalie':'skater'))&&(!weighted||finite(s.weight)&&s.weight!==0));
      const axes=enabled.filter(s=>cohort.filter(p=>value(p,s,impact)!==null).length>=2);
      const common=axes.filter(s=>cohort.every(p=>value(p,s,impact)!==null));
      const contributions=cohort.flatMap(p=>common.map(s=>value(p,s,impact)));
      // One FPTS scale across all spokes preserves category weight magnitude.
      // Per-spoke min/max scaling would silently cancel every positive weight.
      const impactDomain=impact&&weighted?[Math.min(0,...contributions),Math.max(0,...contributions)]:null;
      return [{goalie,players:cohort,axes,common,impactDomain,omitted:enabled.length-common.length,
        profiles:cohort.map(p=>({id:p.id,values:common.map(s=>{
          const values=cohort.map(q=>value(q,s,impact)),lo=Math.min(...values),hi=Math.max(...values);
          if(impactDomain)return 100*(value(p,s,impact)-impactDomain[0])/(impactDomain[1]-impactDomain[0]||1);
          return hi===lo?50:100*(value(p,s,impact)-lo)/(hi-lo);
        })}))}];
    });
  }
  function render(root,options) {
    const {players,stats,impact}=options;
    let state=states.get(root);
    if(!state){state={axes:{},focus:null};states.set(root,state);}
    if(!players.some(p=>p.id===state.focus))state.focus=null;
    root.replaceChildren();
    if(players.length<2)return;
    const doc=root.ownerDocument;
    const el=(tag,text)=>{const n=doc.createElement(tag);if(text!=null)n.textContent=text;return n;};
    const svg=(tag,attrs={},text)=>{const n=doc.createElementNS('http://www.w3.org/2000/svg',tag);for(const [k,v]of Object.entries(attrs))n.setAttribute(k,String(v));if(text!=null)n.textContent=text;return n;};
    const num=v=>finite(v)?v.toLocaleString('en-CA',{maximumFractionDigits:2}):'N/A';
    const color=p=>COLORS[p.colorSlot??players.indexOf(p)];
    const opacity=p=>state.focus&&state.focus!==p.id?0.12:1;
    const rerender=()=>{const focus=doc.activeElement?.getAttribute('data-focus-key');render(root,options);if(focus)Array.from(root.querySelectorAll('[data-focus-key]')).find(n=>n.getAttribute('data-focus-key')===focus)?.focus();};
    const legend=el('div');legend.className='cc-chart-legend';legend.setAttribute('aria-label','Chart player colours');
    players.forEach(p=>{const b=el('button',`${(p.colorSlot??players.indexOf(p))+1}. ${p.name}`);b.type='button';b.setAttribute('data-focus-key','player:'+p.id);b.style.borderLeft=`6px solid ${color(p)}`;b.setAttribute('aria-pressed',String(state.focus===p.id));b.onclick=()=>{state.focus=state.focus===p.id?null:p.id;rerender();};legend.append(b);});
    const all=el('button','Show all players');all.type='button';all.setAttribute('data-focus-key','all');all.onclick=()=>{state.focus=null;rerender();};legend.append(all);root.append(legend);
    const help=el('p','Each colour and number belongs to one player. Select a name to spotlight their data. Charts use enabled scoring categories; a zero-weight category is excluded.');help.className='cc-context';root.append(help);
    if(!stats.some(s=>finite(s.weight)))help.textContent='Each colour and number belongs to one player. Select a name to spotlight their data. These charts show the dated historical metrics listed below, not projected category totals.';
    const focused=players.find(p=>p.id===state.focus);
    if(focused){const summary=el('p',focused.name+': '+stats.filter(s=>(!s.group||s.group===(focused.goalie?'goalie':'skater'))&&(!stats.some(t=>finite(t.weight))||finite(s.weight)&&s.weight!==0)).map(s=>s.label+' '+num(value(focused,s,impact))+(impact?' FPTS':'')).join(' · '));summary.className='cc-context';summary.setAttribute('role','status');root.append(summary);}
    for(const model of models(players,stats,impact)){
      const {goalie,players:cohort,axes,common,profiles}=model,group=goalie?'Goalies':'Skaters';
      const section=el('section');section.className='cc-chart-group';section.setAttribute('aria-label',group+' comparison charts');section.append(el('h4',group));
      if(cohort.length<2){section.append(el('p','Add another '+(goalie?'goalie':'skater')+' to plot comparable categories.'));root.append(section);continue;}
      const grid=el('div');grid.className='cc-chart-grid';
      const scatter=el('div');scatter.className='cc-chart-card';scatter.append(el('h4','Stat map'));
      if(axes.length<2)scatter.append(el('p','Choose a league with at least two enabled categories with data for two players to show a stat map.'));
      else {
        const saved=state.axes[group]??{};
        const x=axes.find(s=>s.key===saved.x)??axes[0];
        const y=axes.find(s=>s.key===saved.y&&s.key!==x.key)??axes.find(s=>s.key!==x.key);
        state.axes[group]={x:x.key,y:y.key};
        const controls=el('div');controls.className='cc-chart-controls';
        for(const [axis,selected]of [['x',x],['y',y]]){
          const label=el('label',axis.toUpperCase()+' axis'),select=el('select');select.setAttribute('aria-label',group+' '+axis.toUpperCase()+' axis');select.setAttribute('data-focus-key',group+':'+axis);
          for(const s of axes){const option=el('option',s.label);option.value=s.key;select.append(option);}select.value=selected.key;
          select.onchange=()=>{const other=axis==='x'?'y':'x';if(state.axes[group][other]===select.value)state.axes[group][other]=state.axes[group][axis];state.axes[group][axis]=select.value;rerender();};label.append(select);controls.append(label);
        }
        scatter.append(controls);
        const points=cohort.map(p=>({p,x:value(p,x,impact),y:value(p,y,impact)})).filter(p=>p.x!==null&&p.y!==null);
        if(points.length<2)scatter.append(el('p','Not enough paired values for these axes. Missing data is not plotted as zero.'));
        else {
          const domain=key=>{const vals=points.map(p=>p[key]),lo=Math.min(...vals),hi=Math.max(...vals),pad=(hi-lo||Math.max(Math.abs(lo),1))*.12;return[lo-pad,hi+pad];};
          const [xmin,xmax]=domain('x'),[ymin,ymax]=domain('y');
          const sx=v=>75+(v-xmin)/(xmax-xmin)*380,sy=v=>290-(v-ymin)/(ymax-ymin)*230;
          const plot=svg('svg',{viewBox:'0 0 520 360',role:'img','aria-label':`${group} stat map: ${x.label} versus ${y.label}, ${impact?'fantasy contribution':'raw values'}`});
          plot.append(svg('title',{},`${group}: ${x.label} / ${y.label}`));
          for(let i=0;i<=4;i++){const xx=xmin+(xmax-xmin)*i/4,yy=ymin+(ymax-ymin)*i/4;
            plot.append(svg('line',{x1:sx(xx),x2:sx(xx),y1:60,y2:290,stroke:'#d3dccd'}),svg('line',{x1:75,x2:455,y1:sy(yy),y2:sy(yy),stroke:'#d3dccd'}),svg('text',{x:sx(xx),y:312,'text-anchor':'middle','font-size':15,fill:'#526759'},num(xx)),svg('text',{x:66,y:sy(yy)+4,'text-anchor':'end','font-size':15,fill:'#526759'},num(yy)));
          }
          plot.append(svg('text',{x:265,y:346,'text-anchor':'middle','font-size':17,fill:'#10291f'},x.label),svg('text',{transform:'translate(18 175) rotate(-90)','text-anchor':'middle','font-size':17,fill:'#10291f'},y.label));
          // Draw the spotlight last so coincident points remain inspectable.
          points.sort((a,b)=>Number(a.p.id===state.focus)-Number(b.p.id===state.focus)).forEach(({p,x:px,y:py})=>{
            const g=svg('g',{opacity:opacity(p)}),circle=svg('circle',{cx:sx(px),cy:sy(py),r:9,fill:color(p),stroke:'#fff','stroke-width':2});
            const description=`${p.name}: ${x.label} ${num(px)}; ${y.label} ${num(py)}`;circle.append(svg('title',{},description));g.append(circle,svg('text',{x:sx(px)+12,y:sy(py)-8,'font-size':12,'font-weight':700,fill:color(p)},String((p.colorSlot??players.indexOf(p))+1)));plot.append(g);
          });
          scatter.append(plot,el('p',`${impact?'Axes are fantasy-point contributions.':'Axes use raw values, not a composite rating.'} ${cohort.length-points.length} players omitted for missing values. Matching points may overlap; spotlight a player to inspect them.`));
        }
      }
      grid.append(scatter);
      const radar=el('div');radar.className='cc-chart-card';radar.append(el('h4','Category profile'));
      if(common.length<3)radar.append(el('p','The area map needs at least three enabled categories shared by every selected '+(goalie?'goalie':'skater')+'. No shape is invented for incomplete data.'));
      else {
        const point=(index,score)=>{const angle=-Math.PI/2+index*2*Math.PI/common.length;return[260+112*score/100*Math.cos(angle),180+112*score/100*Math.sin(angle)];};
        const plot=svg('svg',{viewBox:'0 0 520 360',role:'img','aria-label':group+' relative category area map'});plot.append(svg('title',{},group+' category profiles relative to selected players'));
        for(const ring of [25,50,75,100]){plot.append(svg('polygon',{points:common.map((_,i)=>point(i,ring).join(',')).join(' '),fill:'none',stroke:'#c5d1be'}),svg('text',{x:264,y:180-112*ring/100+12,'font-size':10,fill:'#526759'},model.impactDomain?num(model.impactDomain[0]+(model.impactDomain[1]-model.impactDomain[0])*ring/100):String(ring)));}
        if(model.impactDomain?.[0]<0){const zero=-100*model.impactDomain[0]/(model.impactDomain[1]-model.impactDomain[0]||1);plot.append(svg('polygon',{points:common.map((_,i)=>point(i,zero).join(',')).join(' '),fill:'none',stroke:'#526759','stroke-dasharray':'4 3'}));}
        common.forEach((s,i)=>{const[a,b]=point(i,100),[lx,ly]=point(i,130);plot.append(svg('line',{x1:260,y1:180,x2:a,y2:b,stroke:'#c5d1be'}));const label=svg('text',{x:lx,y:ly,'text-anchor':lx<220?'end':lx>300?'start':'middle','font-size':11,fill:'#10291f'});const words=s.label.split(' ');if(s.label.length>15&&words.length>1){const split=Math.ceil(words.length/2);label.append(svg('tspan',{x:lx,dy:0},words.slice(0,split).join(' ')),svg('tspan',{x:lx,dy:13},words.slice(split).join(' ')));}else label.textContent=s.label;plot.append(label);});
        [...cohort].sort((a,b)=>Number(a.id===state.focus)-Number(b.id===state.focus)).forEach(p=>{
          const profile=profiles.find(r=>r.id===p.id),g=svg('g',{opacity:opacity(p)}),coords=profile.values.map((v,i)=>point(i,v));
          const shape=svg('polygon',{points:coords.map(c=>c.join(',')).join(' '),fill:color(p),'fill-opacity':state.focus===p.id?0.2:0.06,stroke:color(p),'stroke-width':state.focus===p.id?3:1.8});shape.append(svg('title',{},p.name));g.append(shape);
          coords.forEach(([x,y],i)=>{const dot=svg('circle',{cx:x,cy:y,r:3,fill:color(p)});dot.append(svg('title',{},`${p.name}: ${common[i].label} ${num(value(p,common[i],impact))}; relative score ${num(profile.values[i])}`));g.append(dot);});plot.append(g);
        });radar.append(plot);
      }
      const scale=model.impactDomain?`Every spoke uses the same ${num(model.impactDomain[0])} to ${num(model.impactDomain[1])} FPTS scale, so category weights change the shape. Farther out means more points contributed. A dashed ring marks zero when negative contributions are present.`:`Relative to these selected ${group.toLowerCase()}, not NHL percentiles. 0 = lowest, 100 = highest; ties = 50. Higher means a larger raw value, not necessarily better.`;
      radar.append(el('p',`${scale} ${model.omitted} categories omitted for incomplete data. Shapes change when the comparison group changes.`));grid.append(radar);section.append(grid);root.append(section);
    }
  }
  scope.CitrusCompareCharts={COLORS,models,render};
})(globalThis);
