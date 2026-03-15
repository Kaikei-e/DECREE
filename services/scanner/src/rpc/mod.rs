pub mod service;

pub mod proto {
    include!(concat!(env!("OUT_DIR"), "/scanner.v1.rs"));
    include!(concat!(env!("OUT_DIR"), "/scanner.v1.serde.rs"));
}
