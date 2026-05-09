//! axe-adapters: every I/O surface of axe. Each adapter has a test double.

#![forbid(unsafe_code)]
#![deny(rust_2018_idioms, clippy::pedantic)]
#![allow(clippy::module_name_repetitions)]

pub mod acf;
pub mod error;
pub mod workshop_api;
