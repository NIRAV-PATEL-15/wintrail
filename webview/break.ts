import { mount } from "svelte";
import BreakScreen from "./BreakScreen.svelte";

const el = document.getElementById("app")!;
mount(BreakScreen, { target: el, props: { data: JSON.parse(el.dataset.break || "{}") } });
