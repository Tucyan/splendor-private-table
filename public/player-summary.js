const PUBLIC_GEM_ORDER=['white','blue','green','red','black','gold'];

export function publicPlayerGrid(player={}){
  return {
    top:PUBLIC_GEM_ORDER.map(color=>({color,count:player.gems?.[color]||0})),
    bottom:[
      ...PUBLIC_GEM_ORDER.slice(0,-1).map(color=>({kind:'card',color,count:player.bonuses?.[color]||0})),
      {kind:'reserved',count:Array.isArray(player.reserved)?player.reserved.length:0},
    ],
  };
}

export function publicPlayerResources(player={}){
  return PUBLIC_GEM_ORDER.map(color=>color==='gold'
    ?{color,gemCount:player.gems?.[color]||0}
    :{color,gemCount:player.gems?.[color]||0,cardCount:player.bonuses?.[color]||0});
}

export function publicPlayerSummary(player={}){
  return {
    score:player.score||0,
    reservedCount:Array.isArray(player.reserved)?player.reserved.length:0,
    gems:PUBLIC_GEM_ORDER.map(color=>[color,player.gems?.[color]||0]),
    bonuses:PUBLIC_GEM_ORDER.slice(0,-1).map(color=>[color,player.bonuses?.[color]||0]),
  };
}
