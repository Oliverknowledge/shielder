//! Hand-authored equivalents of `proto/shield/v1/behavioral.proto`, using
//! `prost::Message`'s derive directly against field-tagged structs. This is
//! exactly what `substreams protogen` / `buf generate` would produce from
//! that .proto file; we generate it by hand here because this sandbox has
//! no network path to the substreams CLI or a buf toolchain. The two must
//! be kept in sync by hand until CI has real protogen wired in (see
//! substreams/README.md).

#[derive(Clone, PartialEq, ::prost::Message)]
pub struct VaultTransfer {
    #[prost(string, tag = "1")]
    pub vault: ::prost::alloc::string::String,
    #[prost(string, tag = "2")]
    pub signature: ::prost::alloc::string::String,
    #[prost(int64, tag = "3")]
    pub slot: i64,
    #[prost(int64, tag = "4")]
    pub block_time: i64,
    /// Wire type is plain i32 (not prost's `enumeration` field type, to
    /// avoid depending on prost-version-specific enum-derive machinery in
    /// this hand-authored pb module) -- semantics live in
    /// `vault_transfer::Kind`'s `TryFrom<i32>` impl below.
    #[prost(int32, tag = "5")]
    pub kind: i32,
    #[prost(string, tag = "6")]
    pub destination_owner: ::prost::alloc::string::String,
    #[prost(uint64, tag = "7")]
    pub amount_usdc_raw: u64,
}

pub mod vault_transfer {
    #[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
    #[repr(i32)]
    pub enum Kind {
        Unspecified = 0,
        Deposit = 1,
        InstantTopUp = 2,
        ProposedTopUpExecuted = 3,
        InstantColdTransfer = 4,
        ProposedColdTransferAboveCapExecuted = 5,
        FullExitExecuted = 6,
        RegisterExecution = 7,
        RegisterColdExecuted = 8,
        RemoveRegistration = 9,
        Tighten = 10,
        ApplyCreVerdict = 11,
    }

    impl TryFrom<i32> for Kind {
        type Error = ();
        fn try_from(v: i32) -> Result<Self, Self::Error> {
            match v {
                0 => Ok(Kind::Unspecified),
                1 => Ok(Kind::Deposit),
                2 => Ok(Kind::InstantTopUp),
                3 => Ok(Kind::ProposedTopUpExecuted),
                4 => Ok(Kind::InstantColdTransfer),
                5 => Ok(Kind::ProposedColdTransferAboveCapExecuted),
                6 => Ok(Kind::FullExitExecuted),
                7 => Ok(Kind::RegisterExecution),
                8 => Ok(Kind::RegisterColdExecuted),
                9 => Ok(Kind::RemoveRegistration),
                10 => Ok(Kind::Tighten),
                11 => Ok(Kind::ApplyCreVerdict),
                _ => Err(()),
            }
        }
    }
}

#[derive(Clone, PartialEq, ::prost::Message)]
pub struct VaultTransfers {
    #[prost(message, repeated, tag = "1")]
    pub transfers: ::prost::alloc::vec::Vec<VaultTransfer>,
}

#[derive(Clone, PartialEq, ::prost::Message)]
pub struct SwapEvent {
    #[prost(string, tag = "1")]
    pub execution_wallet: ::prost::alloc::string::String,
    #[prost(string, tag = "2")]
    pub signature: ::prost::alloc::string::String,
    #[prost(int64, tag = "3")]
    pub slot: i64,
    #[prost(int64, tag = "4")]
    pub block_time: i64,
    #[prost(string, tag = "5")]
    pub venue: ::prost::alloc::string::String,
    #[prost(string, tag = "6")]
    pub in_mint: ::prost::alloc::string::String,
    #[prost(uint64, tag = "7")]
    pub in_amount_raw: u64,
    #[prost(string, tag = "8")]
    pub out_mint: ::prost::alloc::string::String,
    #[prost(uint64, tag = "9")]
    pub out_amount_raw: u64,
}

#[derive(Clone, PartialEq, ::prost::Message)]
pub struct ExecutionWalletActivity {
    #[prost(message, repeated, tag = "1")]
    pub swaps: ::prost::alloc::vec::Vec<SwapEvent>,
}

#[derive(Clone, PartialEq, ::prost::Message)]
pub struct ClosedCycle {
    #[prost(string, tag = "1")]
    pub execution_wallet: ::prost::alloc::string::String,
    #[prost(uint64, tag = "2")]
    pub usdc_out_raw: u64,
    #[prost(uint64, tag = "3")]
    pub usdc_in_raw: u64,
    #[prost(int64, tag = "4")]
    pub opened_at: i64,
    #[prost(int64, tag = "5")]
    pub closed_at: i64,
    #[prost(bool, tag = "6")]
    pub is_loss: bool,
}

#[derive(Clone, PartialEq, ::prost::Message)]
pub struct UserBehavioralProfile {
    #[prost(string, tag = "1")]
    pub vault: ::prost::alloc::string::String,
    #[prost(string, tag = "2")]
    pub authority: ::prost::alloc::string::String,
    #[prost(uint64, tag = "3")]
    pub top_up_total_usdc_raw: u64,
    #[prost(uint64, tag = "4")]
    pub return_total_usdc_raw: u64,
    #[prost(int64, tag = "5")]
    pub realized_pnl_usdc_raw: i64,
    #[prost(uint32, tag = "6")]
    pub loss_streak: u32,
    #[prost(int64, tag = "7")]
    pub loss_streak_last_updated: i64,
    #[prost(uint64, tag = "8")]
    pub median_funding_size_usdc_raw: u64,
    #[prost(uint64, tag = "9")]
    pub rolling_velocity_usdc_raw: u64,
    #[prost(string, repeated, tag = "10")]
    pub registered_execution_wallets: ::prost::alloc::vec::Vec<::prost::alloc::string::String>,
    #[prost(string, repeated, tag = "11")]
    pub registered_cold_wallets: ::prost::alloc::vec::Vec<::prost::alloc::string::String>,
    #[prost(int64, tag = "12")]
    pub last_updated_at: i64,
}

#[derive(Clone, PartialEq, ::prost::Message)]
pub struct UserBehavioralProfiles {
    #[prost(message, repeated, tag = "1")]
    pub profiles: ::prost::alloc::vec::Vec<UserBehavioralProfile>,
}
