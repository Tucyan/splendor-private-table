const hues={white:'#e9f7ff',blue:'#438ff0',green:'#38c99a',red:'#f26a80',black:'#8f91ba',gold:'#edbd5c'};
const cuts={
  white:['M9 3h14l7 9-14 18L2 12z','M9 3l4 9H2zm14 0-4 9h11zM13 12l3 18 3-18z','M9 3h14l-4 9h-6z'],
  blue:['M16 2 28 9v14l-12 7L4 23V9z','M16 2v7l-7 4-5-4zm12 7-5 4v8l5 2zM9 21l7 9V23z','M9 13l7-4 7 4v8l-7 3-7-3z'],
  green:['M10 2h12l5 6v16l-5 6H10l-5-6V8z','M10 2v7l-5-1zm12 0 5 6-6 3H11L10 2zM5 24l6-3v-10L5 8z','M11 11h10v10H11zM10 30l1-9h10l1 9z'],
  red:['M16 2C24 2 30 9 30 16S24 30 16 30 2 23 2 16 8 2 16 2z','M16 2 8 11l-6 5 7 6 7 8-4-14zm0 0 8 9 6 5-9-2z','M8 11l8-5 8 5 3 9-11 7-11-7z'],
  black:['M16 1 28 14 26 23 16 31 6 23 4 14z','M16 1v11L4 14zm0 11 10 11 2-9zM6 23l10 8v-8z','M16 12l10 11-10 0L4 14z'],
  gold:['M16 2a14 14 0 1 1 0 28 14 14 0 0 1 0-28z','M5 17A11 11 0 0 1 22 7L16 4 7 8z','M16 8l3 5 5 3-5 3-3 5-3-5-5-3 5-3z'],
};
export function gem(color,size=22){
  const [outline,light,shade]=cuts[color]||cuts.white;
  return `<svg class="gem gem-${color in cuts?color:'white'}" width="${size}" height="${size}" viewBox="0 0 32 32" aria-hidden="true" style="color:${hues[color]||hues.white}"><path d="${outline}" fill="currentColor" stroke="#ffffff55" stroke-width=".7"/><path d="${shade}" fill="#101828" opacity=".24"/><path d="${light}" fill="#fff" opacity=".48"/>${color==='gold'?'<circle cx="16" cy="16" r="11" fill="none" stroke="#fff" stroke-opacity=".45"/>':''}</svg>`;
}
