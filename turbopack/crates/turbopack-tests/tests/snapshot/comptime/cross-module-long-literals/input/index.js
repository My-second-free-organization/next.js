import { LONG_STRING, LONG_NUMBER, LONG_BIG_NUMBER, LONG_REGEX } from './other'

// shouldn't inline
console.log(LONG_STRING, LONG_NUMBER, LONG_BIG_NUMBER, LONG_REGEX)

if (LONG_STRING && LONG_NUMBER && LONG_BIG_NUMBER && LONG_REGEX) {
  console.log('ok')
} else {
  // TODO ideally would still use for evaluation
  console.log('suboptimal')
  // require('./dead-code')
}
