#!/usr/bin/env node
import { departments } from './lib.mjs';
console.log(JSON.stringify(departments().map((d) => d.slug)));
