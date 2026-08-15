/** Cheap episode score. Not a reward model, not PPO. */

export function scoreEpisode(ep) {
  const sand = Number(ep && ep.sand) || 0
  const dirt = Number(ep && ep.dirt) || 0
  const sandstone = Number(ep && ep.sandstone) || 0
  const houseBlocks = Number(ep && (ep.house_blocks != null ? ep.house_blocks : ep.houseBlocks)) || 0
  const house = !!(ep && (ep.house === true || ep.house === 'yes' || ep.house === 1))
  const seconds = Number(ep && (ep.seconds != null ? ep.seconds : ep.seconds_alive)) || 0
  const deaths = Number(ep && ep.deaths) || 0
  const grief = Number(ep && (ep.grief_planks != null ? ep.grief_planks : ep.griefPlanks)) || 0
  return sand * 2
    + dirt
    + sandstone * 4
    + houseBlocks * 5
    + (house ? 50 : 0)
    + seconds / 10
    - deaths * 20
    - grief * 10
}

export default scoreEpisode
