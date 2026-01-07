from playwright.sync_api import sync_playwright
import time

def verify(page):
    page.on("console", lambda msg: print(f"Console: {msg.text}"))
    page.on("pageerror", lambda exc: print(f"Page Error: {exc}"))

    try:
        page.goto("http://localhost:5173")
        page.wait_for_load_state("networkidle")

        # Check Title
        title = page.title()
        print(f"Page title: {title}")

        # Check Sidebar elements
        if page.locator(".sidebar").is_visible():
            print("Sidebar is visible")
        else:
            print("Sidebar is NOT visible")

        # Check Inputs
        slider_a = page.locator("#num-a")
        if slider_a.is_visible():
            print("Slider A is visible")

        # Take screenshot
        page.screenshot(path="verification.png")

    except Exception as e:
        print(f"Error during verification: {e}")

if __name__ == "__main__":
    with sync_playwright() as p:
        # Try to launch with args that might help WebGPU (often unavailable though)
        browser = p.chromium.launch(
            headless=True,
            args=["--enable-unsafe-webgpu"]
        )
        page = browser.new_page()
        verify(page)
        browser.close()
