const COLORS=['white','blue','green','red','black'];

export function discountedCost(player,card){
  return Object.fromEntries(COLORS.map(c=>[c,Math.max(0,(card.cost[c]||0)-(player.bonuses[c]||0))]));
}

// Color deficits are shown before allocating wild gold, because the player may
// choose which colors gold replaces. The final total deducts gold exactly once.
export function purchaseGap(player,card){
  const colors={};
  for(const color of COLORS){
    const missing=Math.max(0,(card.cost[color]||0)-(player.bonuses[color]||0)-(player.gems[color]||0));
    if(missing)colors[color]=missing;
  }
  const total=Object.values(colors).reduce((a,b)=>a+b,0);
  const goldUsed=Math.min(total,player.gems.gold||0);
  return {colors,goldUsed,remaining:total-goldUsed};
}

export function canAffordCard(player,card){
  return !!player&&purchaseGap(player,card).remaining===0;
}
