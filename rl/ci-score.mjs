/** scoreEpisode unit tests. Not a live episode scorer. */
import { scoreEpisode } from './score.js'

function assertEq(got, want, label) {
  if (got !== want) {
    console.error('score FAIL: ' + label + ' expected ' + want + ' got ' + got)
    process.exit(1)
  }
  console.log('score OK: ' + label + ' = ' + got)
}

// sand*2 + dirt + seconds/10 = 4 + 9 + 3 = 16
assertEq(scoreEpisode({ sand: 2, dirt: 9, seconds: 30 }), 16, 'sand2+dirt9+sec30')

// -deaths*20 - grief_planks*10 = -20 - 10 = -30
assertEq(scoreEpisode({ deaths: 1, grief_planks: 1 }), -30, 'death1+grief1')
assertEq(scoreEpisode({ deaths: 1, griefPlanks: 1 }), -30, 'death1+griefPlanks1')
