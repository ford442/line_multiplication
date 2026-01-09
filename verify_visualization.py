import time
from playwright.sync_api import sync_playwright

def verify_visualization():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        # Go to the local dev server
        page.goto("http://localhost:5173")

        # Wait for the animations in the sidebar SVG to complete (longest delay is 3.5s + 1s animation = 4.5s)
        time.sleep(5)

        # Take a screenshot of the entire page
        page.screenshot(path="verification.png", full_page=True)

        # Also take a specific screenshot of the sidebar SVG to verify animations worked
        svg_element = page.locator("#demo-svg")
        if svg_element.count() > 0:
            svg_element.screenshot(path="verification_svg.png")

        browser.close()

if __name__ == "__main__":
    verify_visualization()
