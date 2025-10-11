use leptos::*;
use leptos_meta::*;
use leptos_router::*;

#[component]
pub fn App() -> impl IntoView {
    provide_meta_context();

    view! {
        <Stylesheet id="leptos" href="/pkg/frontend.css"/>
        <Title text="Ruy Wiki App"/>
        <Router>
            <main>
                <Routes>
                    <Route path="" view=HomePage/>
                    <Route path="/about" view=AboutPage/>
                </Routes>
            </main>
        </Router>
    }
}

#[component]
fn HomePage() -> impl IntoView {
    let (count, set_count) = create_signal(0);

    view! {
        <div class="container">
            <h1>"Welcome to Ruy Wiki App"</h1>
            <p>"This is a Rust-based wiki application with:"</p>
            <ul>
                <li>"Rust backend API (Axum)"</li>
                <li>"Leptos frontend (WebAssembly)"</li>
            </ul>
            
            <div class="counter">
                <h2>"Counter Example"</h2>
                <button on:click=move |_| set_count.update(|n| *n += 1)>
                    "Click me: " {count}
                </button>
            </div>

            <div class="navigation">
                <A href="/about">"About"</A>
            </div>
        </div>
    }
}

#[component]
fn AboutPage() -> impl IntoView {
    view! {
        <div class="container">
            <h1>"About"</h1>
            <p>"This is a demo wiki application built with:"</p>
            <ul>
                <li><strong>"Backend:"</strong>" Rust with Axum framework"</li>
                <li><strong>"Frontend:"</strong>" Leptos (Rust WebAssembly)"</li>
            </ul>
            
            <div class="navigation">
                <A href="/">"Home"</A>
            </div>
        </div>
    }
}

#[wasm_bindgen::prelude::wasm_bindgen]
pub fn hydrate() {
    console_error_panic_hook::set_once();
    leptos::mount_to_body(App);
}
