use crate::{
    media::{self, MediaStore},
    model::Index,
    planning,
    prefab::Prefab,
    source::Source,
    unity::Unity,
};
use anyhow::{Context, Result};
use serde_json::json;
use std::{collections::BTreeSet, sync::Arc};

pub const BUNDLES: [&str; 2] = ["ui/[uc]common.ab", "ui/[uc]charsortfilter.ab"];

/// Application controls use the same named prefab references as the client.
/// The stored sprite border lets the host stretch panels without stretching corners.
pub async fn prepare(index: &Index, source: &Source, store: Arc<MediaStore>) -> Result<String> {
    let mut inputs = Vec::new();
    let mut bundles: BTreeSet<_> = BUNDLES.iter().map(|s| s.to_string()).collect();
    bundles.extend(planning::dependencies(index, &bundles));
    for name in bundles {
        inputs.push((name.clone(), source.bundle(&name).await?));
    }
    let cancel = source.cancellation();
    crate::runtime::blocking(move || {
        let env = Unity::open_named(&inputs, cancel)?;
        let schema = env.schema_with_field(114, "m_Sprite")?;
        let mut graphics = serde_json::Map::new();
        for (role, root, node) in [
            (
                "dropdown-normal",
                "prefab_dropdown_entry",
                "panel_unselected/img_bkg",
            ),
            (
                "dropdown-selected",
                "prefab_dropdown_entry",
                "panel_selected/img_bkg",
            ),
            (
                "dropdown-arrow",
                "prefab_dropdown_entry",
                "panel_unselected/img_arrow",
            ),
            (
                "dropdown-panel",
                "simple_dropdown_dialog",
                "panel_scroll_rect",
            ),
            ("dropdown-line", "prefab_simple_dropdown_item", "img_split"),
            (
                "back",
                "dyn_star_mark_edit_panel",
                "panel_starMarkCnt/btn_topmenu_back",
            ),
        ] {
            let prefab = Prefab::new(&env, root, None)?;
            let path = format!("{root}/{node}");
            let (image, row) = prefab.component(&path, "Image", Some(&schema))?;
            let sprite = env
                .resolve(image, &row["m_Sprite"])?
                .context("Application control sprite missing")?;
            let (pixels, metadata) = media::sprite(&env, sprite)?;
            let filename = format!("native-app-{role}.png");
            store.named_image(&filename, &pixels)?;
            let b = metadata.border;
            graphics.insert(
                role.into(),
                json!({
                    "sprite": filename, "source":path, "name":metadata.name,
                    "width":pixels.width(), "height":pixels.height(),
                    "border":[b.x,b.y,b.z,b.w], "sliced":row["m_Type"].as_i64()==Some(1)
                }),
            );
        }
        store.named("native-app-widgets.json", &serde_json::to_vec(&graphics)?)
    })
    .await?
}
