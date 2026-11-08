use super::{init_db, DbPool};
use std::collections::HashMap;

#[tokio::test]
async fn test_tenant_fixturelari_rolleri_fifo_partilerini_ve_secilen_resetini_korur() {
    let mut fixtures = AcceptanceFixtures::start().await.expect("TEST fixtureları");
    let test_a = fixtures.tenant("TEST_A").expect("TEST_A");
    let test_b = fixtures.tenant("TEST_B").expect("TEST_B");
    let tenant_a = tenant_id("TEST_A").expect("TEST_A kimliği");
    let tenant_b = tenant_id("TEST_B").expect("TEST_B kimliği");

    for (db, tenant) in [(&test_a, tenant_a), (&test_b, tenant_b)] {
        let roles: Vec<(String, i64)> =
            sqlx::query_as("SELECT role, is_active FROM users WHERE tenant_id=? ORDER BY role, id")
                .bind(tenant)
                .fetch_all(db)
                .await
                .expect("personeller");
        assert_eq!(roles.len(), 6);
        assert_eq!(roles.iter().filter(|(_, active)| *active == 1).count(), 5);
        assert_eq!(
            roles
                .iter()
                .filter(|(role, active)| role == "WAITER" && *active == 0)
                .count(),
            1
        );

        let hashes: Vec<String> =
            sqlx::query_scalar("SELECT pin_hash FROM users WHERE tenant_id=? ORDER BY id")
                .bind(tenant)
                .fetch_all(db)
                .await
                .expect("PIN PHC değerleri");
        assert!(hashes.iter().all(|hash| hash.starts_with("$argon2id$")));

        let product_price: i64 =
            sqlx::query_scalar("SELECT price_cents FROM products WHERE tenant_id=?")
                .bind(tenant)
                .fetch_one(db)
                .await
                .expect("ürün fiyatı");
        assert_eq!(product_price, 12500);

        let lots: Vec<(i64, i64)> = sqlx::query_as(
            "SELECT CAST(initial_quantity AS INTEGER), unit_cost_cents
             FROM inventory_batches WHERE tenant_id=? ORDER BY received_at, id",
        )
        .bind(tenant)
        .fetch_all(db)
        .await
        .expect("FIFO partileri");
        assert_eq!(lots, vec![(2, 200), (3, 500)]);
    }

    sqlx::query("UPDATE products SET name='A değişti' WHERE tenant_id=?")
        .bind(tenant_a)
        .execute(&test_a)
        .await
        .expect("A işaretleyicisi");
    sqlx::query("UPDATE products SET name='B korunacak' WHERE tenant_id=?")
        .bind(tenant_b)
        .execute(&test_b)
        .await
        .expect("B işaretleyicisi");

    assert!(fixtures.reset_tenant("PRODUCTION").await.is_err());
    fixtures
        .reset_tenant("TEST_A")
        .await
        .expect("yalnız A sıfırlanır");
    let reset_a = fixtures.tenant("TEST_A").expect("yenilenen A");
    let fresh_a: String = sqlx::query_scalar("SELECT name FROM products WHERE tenant_id=?")
        .bind(tenant_a)
        .fetch_one(&reset_a)
        .await
        .expect("A fixture adı");
    let intact_b: String = sqlx::query_scalar("SELECT name FROM products WHERE tenant_id=?")
        .bind(tenant_b)
        .fetch_one(&test_b)
        .await
        .expect("B fixture adı");
    assert_eq!(fresh_a, "TEST_A ürün");
    assert_eq!(intact_b, "B korunacak");
}

fn tenant_id(key: &str) -> Option<&'static str> {
    match key {
        "TEST_A" => Some("tnt_01arz3ndektsv4rrffq69g5fav"),
        "TEST_B" => Some("tnt_01arz3ndektsv4rrffq69g5faw"),
        _ => None,
    }
}

struct PersonFixture {
    id: &'static str,
    role: &'static str,
    name: &'static str,
    active: bool,
}

struct TenantFixture {
    key: &'static str,
    tenant_id: &'static str,
    category_id: &'static str,
    product_id: &'static str,
    product_name: &'static str,
    device_id: &'static str,
    batch_ids: [&'static str; 2],
    people: [PersonFixture; 6],
}

const FIXTURES: [TenantFixture; 2] = [
    TenantFixture {
        key: "TEST_A",
        tenant_id: "tnt_01arz3ndektsv4rrffq69g5fav",
        category_id: "cat_01arz3ndektsv4rrffq69g5fa8",
        product_id: "prd_01arz3ndektsv4rrffq69g5fa7",
        product_name: "TEST_A ürün",
        device_id: "dev_01arz3ndektsv4rrffq69g5fa9",
        batch_ids: [
            "bat_01arz3ndektsv4rrffq69g5faa",
            "bat_01arz3ndektsv4rrffq69g5fab",
        ],
        people: [
            PersonFixture {
                id: "usr_01arz3ndektsv4rrffq69g5fa1",
                role: "OWNER",
                name: "TEST_A Owner",
                active: true,
            },
            PersonFixture {
                id: "usr_01arz3ndektsv4rrffq69g5fa2",
                role: "MANAGER",
                name: "TEST_A Manager",
                active: true,
            },
            PersonFixture {
                id: "usr_01arz3ndektsv4rrffq69g5fa3",
                role: "CASHIER",
                name: "TEST_A Cashier",
                active: true,
            },
            PersonFixture {
                id: "usr_01arz3ndektsv4rrffq69g5fa4",
                role: "WAITER",
                name: "TEST_A Waiter",
                active: true,
            },
            PersonFixture {
                id: "usr_01arz3ndektsv4rrffq69g5fa5",
                role: "KITCHEN",
                name: "TEST_A Kitchen",
                active: true,
            },
            PersonFixture {
                id: "usr_01arz3ndektsv4rrffq69g5fa6",
                role: "WAITER",
                name: "TEST_A Inactive",
                active: false,
            },
        ],
    },
    TenantFixture {
        key: "TEST_B",
        tenant_id: "tnt_01arz3ndektsv4rrffq69g5faw",
        category_id: "cat_01arz3ndektsv4rrffq69g5fb8",
        product_id: "prd_01arz3ndektsv4rrffq69g5fb7",
        product_name: "TEST_B ürün",
        device_id: "dev_01arz3ndektsv4rrffq69g5fb9",
        batch_ids: [
            "bat_01arz3ndektsv4rrffq69g5fba",
            "bat_01arz3ndektsv4rrffq69g5fbb",
        ],
        people: [
            PersonFixture {
                id: "usr_01arz3ndektsv4rrffq69g5fb1",
                role: "OWNER",
                name: "TEST_B Owner",
                active: true,
            },
            PersonFixture {
                id: "usr_01arz3ndektsv4rrffq69g5fb2",
                role: "MANAGER",
                name: "TEST_B Manager",
                active: true,
            },
            PersonFixture {
                id: "usr_01arz3ndektsv4rrffq69g5fb3",
                role: "CASHIER",
                name: "TEST_B Cashier",
                active: true,
            },
            PersonFixture {
                id: "usr_01arz3ndektsv4rrffq69g5fb4",
                role: "WAITER",
                name: "TEST_B Waiter",
                active: true,
            },
            PersonFixture {
                id: "usr_01arz3ndektsv4rrffq69g5fb5",
                role: "KITCHEN",
                name: "TEST_B Kitchen",
                active: true,
            },
            PersonFixture {
                id: "usr_01arz3ndektsv4rrffq69g5fb6",
                role: "WAITER",
                name: "TEST_B Inactive",
                active: false,
            },
        ],
    },
];

const TEST_PIN: &str = "4827";

struct AcceptanceFixtures {
    databases: HashMap<&'static str, DbPool>,
}

impl AcceptanceFixtures {
    async fn start() -> Result<Self, String> {
        let mut databases = HashMap::new();
        for fixture in &FIXTURES {
            databases.insert(fixture.key, seed_tenant(fixture).await?);
        }
        Ok(Self { databases })
    }

    fn tenant(&self, key: &str) -> Option<DbPool> {
        self.databases.get(key).cloned()
    }

    async fn reset_tenant(&mut self, key: &str) -> Result<(), String> {
        let fixture = FIXTURES
            .iter()
            .find(|fixture| fixture.key == key)
            .ok_or_else(|| "Allowlist dışındaki test tenant adı reddedildi.".to_string())?;
        if let Some(database) = self.databases.remove(fixture.key) {
            database.close().await;
        }
        self.databases
            .insert(fixture.key, seed_tenant(fixture).await?);
        Ok(())
    }
}

async fn seed_tenant(fixture: &TenantFixture) -> Result<DbPool, String> {
    let database = init_db("sqlite::memory:")
        .await
        .map_err(|error| error.to_string())?;
    sqlx::query("INSERT INTO tenants (id,name,status) VALUES (?,?, 'ACTIVE')")
        .bind(fixture.tenant_id)
        .bind(format!("KASAM360 {}", fixture.key))
        .execute(&database)
        .await
        .map_err(|error| error.to_string())?;

    for person in &fixture.people {
        let pin_hash = crate::user_credentials::hash_pin(TEST_PIN)?;
        sqlx::query(
            "INSERT INTO users (id,tenant_id,role,name,pin_hash,pin_length,is_active)
             VALUES (?,?,?,?,?,?,?)",
        )
        .bind(person.id)
        .bind(fixture.tenant_id)
        .bind(person.role)
        .bind(person.name)
        .bind(pin_hash)
        .bind(TEST_PIN.len() as i64)
        .bind(i64::from(person.active))
        .execute(&database)
        .await
        .map_err(|error| error.to_string())?;
    }

    sqlx::query(
        "INSERT INTO devices (id,tenant_id,name,device_type,status)
         VALUES (?,?,?,'POS','ACTIVE')",
    )
    .bind(fixture.device_id)
    .bind(fixture.tenant_id)
    .bind(format!("{} POS", fixture.key))
    .execute(&database)
    .await
    .map_err(|error| error.to_string())?;
    sqlx::query("INSERT INTO categories (id,tenant_id,name) VALUES (?,?, 'Test ürünler')")
        .bind(fixture.category_id)
        .bind(fixture.tenant_id)
        .execute(&database)
        .await
        .map_err(|error| error.to_string())?;
    sqlx::query(
        "INSERT INTO products (id,tenant_id,category_id,name,price_cents)
         VALUES (?,?,?,?,12500)",
    )
    .bind(fixture.product_id)
    .bind(fixture.tenant_id)
    .bind(fixture.category_id)
    .bind(fixture.product_name)
    .execute(&database)
    .await
    .map_err(|error| error.to_string())?;
    for ((batch_id, code), quantity, cost, received_at) in [
        (
            (fixture.batch_ids[0], "A"),
            2_i64,
            200_i64,
            "2026-01-01 09:00:00",
        ),
        (
            (fixture.batch_ids[1], "B"),
            3_i64,
            500_i64,
            "2026-01-02 09:00:00",
        ),
    ] {
        sqlx::query(
            "INSERT INTO inventory_batches
             (id,tenant_id,product_id,batch_code,received_at,initial_quantity,remaining_quantity,unit_cost_cents)
             VALUES (?,?,?,?,?,?,?,?)",
        )
        .bind(batch_id)
        .bind(fixture.tenant_id)
        .bind(fixture.product_id)
        .bind(format!("{}-{code}", fixture.key))
        .bind(received_at)
        .bind(quantity)
        .bind(quantity)
        .bind(cost)
        .execute(&database)
        .await
        .map_err(|error| error.to_string())?;
    }
    Ok(database)
}
