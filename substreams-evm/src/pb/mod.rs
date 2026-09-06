// @generated
pub mod google {
    // @@protoc_insertion_point(attribute:google.protobuf)
    pub mod protobuf {
        include!("google.protobuf.rs");
        // @@protoc_insertion_point(google.protobuf)
    }
}
// @@protoc_insertion_point(attribute:schema)
pub mod schema {
    include!("schema.rs");
    // @@protoc_insertion_point(schema)
}
pub mod sf {
    pub mod ethereum {
        pub mod r#type {
            // @@protoc_insertion_point(attribute:sf.ethereum.type.v2)
            pub mod v2 {
                include!("sf.ethereum.type.v2.rs");
                // @@protoc_insertion_point(sf.ethereum.type.v2)
            }
        }
        pub mod substreams {
            // @@protoc_insertion_point(attribute:sf.ethereum.substreams.v1)
            pub mod v1 {
                include!("sf.ethereum.substreams.v1.rs");
                // @@protoc_insertion_point(sf.ethereum.substreams.v1)
            }
        }
        pub mod transform {
            // @@protoc_insertion_point(attribute:sf.ethereum.transform.v1)
            pub mod v1 {
                include!("sf.ethereum.transform.v1.rs");
                // @@protoc_insertion_point(sf.ethereum.transform.v1)
            }
        }
    }
    pub mod firehose {
        // @@protoc_insertion_point(attribute:sf.firehose.v2)
        pub mod v2 {
            include!("sf.firehose.v2.rs");
            // @@protoc_insertion_point(sf.firehose.v2)
        }
    }
    // @@protoc_insertion_point(attribute:sf.substreams)
    pub mod substreams {
        include!("sf.substreams.rs");
        // @@protoc_insertion_point(sf.substreams)
        pub mod ethereum {
            // @@protoc_insertion_point(attribute:sf.substreams.ethereum.v1)
            pub mod v1 {
                include!("sf.substreams.ethereum.v1.rs");
                // @@protoc_insertion_point(sf.substreams.ethereum.v1)
            }
        }
        pub mod index {
            // @@protoc_insertion_point(attribute:sf.substreams.index.v1)
            pub mod v1 {
                include!("sf.substreams.index.v1.rs");
                // @@protoc_insertion_point(sf.substreams.index.v1)
            }
        }
        pub mod rpc {
            // @@protoc_insertion_point(attribute:sf.substreams.rpc.v2)
            pub mod v2 {
                include!("sf.substreams.rpc.v2.rs");
                // @@protoc_insertion_point(sf.substreams.rpc.v2)
            }
        }
        pub mod sink {
            pub mod service {
                // @@protoc_insertion_point(attribute:sf.substreams.sink.service.v1)
                pub mod v1 {
                    include!("sf.substreams.sink.service.v1.rs");
                    // @@protoc_insertion_point(sf.substreams.sink.service.v1)
                }
            }
            pub mod sql {
                pub mod service {
                    // @@protoc_insertion_point(attribute:sf.substreams.sink.sql.service.v1)
                    pub mod v1 {
                        include!("sf.substreams.sink.sql.service.v1.rs");
                        // @@protoc_insertion_point(sf.substreams.sink.sql.service.v1)
                    }
                }
                // @@protoc_insertion_point(attribute:sf.substreams.sink.sql.v1)
                pub mod v1 {
                    include!("sf.substreams.sink.sql.v1.rs");
                    // @@protoc_insertion_point(sf.substreams.sink.sql.v1)
                }
            }
        }
        // @@protoc_insertion_point(attribute:sf.substreams.v1)
        pub mod v1 {
            include!("sf.substreams.v1.rs");
            // @@protoc_insertion_point(sf.substreams.v1)
        }
    }
}
pub mod shield {
    pub mod evm {
        // @@protoc_insertion_point(attribute:shield.evm.v1)
        pub mod v1 {
            include!("shield.evm.v1.rs");
            // @@protoc_insertion_point(shield.evm.v1)
        }
    }
}
