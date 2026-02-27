import { IS_DEV, SOME_VALUE, NO_CONSTANT, MISSING } from './other'

if (SOME_VALUE === 'x') {
  console.log('x')
} else {
  require('./dead-code')
}
console.log(SOME_VALUE)

// --------------------------------------------------------------------------

if (IS_DEV) {
  console.log('is_dev')
} else {
  require('./dead-code')
}
console.log(IS_DEV)

// --------------------------------------------------------------------------

if (NO_CONSTANT) {
  console.log('NO_CONSTANT 1')
} else {
  console.log('NO_CONSTANT 2')
}
console.log(NO_CONSTANT)

// --------------------------------------------------------------------------

if (MISSING) {
  console.log('MISSING 1')
} else {
  console.log('MISSING 2')
}
console.log(MISSING)
