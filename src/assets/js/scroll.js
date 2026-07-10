import { isMobileDevice } from "./utils.js";

// Scroll to the top of the page when it's loaded. This overrides default browser behavior
window.onbeforeunload = function () {
  window.scrollTo(0, 0);
};

// When the user scrolls down 50px from the top of the document, resize the logo and move it.
window.onscroll = function () {
  scrollFunction();
};

// Global variables
let isTopOfPage = true;
const isMobile = isMobileDevice();
const topGradient = document.querySelector("#top-gradient");
const logoImageMini = document.querySelector("#clt-logo-mini");
const footer = document.querySelector("#clt-footer");
const footerText = document.querySelector(".clt-footer-text");
const astroWheel = document.querySelector(".clt-inner-right");
const parallaxImage = document.querySelector(".parallax-background");

// Search the entire page for anchor tags.
// If the href value starts with # then attach a click handler to it that scrolls smoothly to the element.
document.querySelectorAll('a[href^="#"]').forEach((anchor) => {
  anchor.addEventListener("click", function (e) {
    e.preventDefault();
    const targetId = this.getAttribute("href");
    const targetElement = document.querySelector(targetId);

    if (targetElement) {
      targetElement.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    }
  });
});

function setIsTopOfPage(value) {
  // Only set the variable value passed in if it's different than the one stored.
  if (isTopOfPage !== value) {
    isTopOfPage = value;
  }
}

function getScrollSpeed(scrollPosition) {
  let result;
  if (isMobile) {
    result = scrollPosition * 0.8 + "px";
  } else {
    result = -scrollPosition * 0.16 + "px";
  }
  return result;
}

function scrollFunction() {
  // First, get the current scroll position
  let scrollPositionY = window.scrollY;

  // Then, apply the parallax effect to the background, this always will scroll.
  parallaxImage.style.backgroundPositionY = getScrollSpeed(scrollPositionY);

  // Check if the user has scrolled down more than 340px from the top of the page, if so,
  if (scrollPositionY > 340 && isTopOfPage) {
    setIsTopOfPage(false);
  } else if (scrollPositionY < 340 && !isTopOfPage) {
    setIsTopOfPage(true);
  } else {
    // Do nothing, the state hasn't changed
  }

  if (isTopOfPage) {
    logoImageMini.style.transform = "translateY(-400px)";
    displayTopGradient(false);
  } else {
    logoImageMini.style.transform = "translateY(0)";
    displayTopGradient(true);
  }

  if (isElementInViewport(footerText)) {
    footer.classList.add("visible");
  } else {
    footer.classList.remove("visible");
  }

  if (!isMobile && isElementInMiddle(astroWheel)) {
    astroWheel.classList.add("twinkle");
  } else {
    astroWheel.classList.remove("twinkle");
  }
}

function isElementInMiddle(element) {
  const rect = element.getBoundingClientRect();
  const elementCenterY = rect.top + rect.height / 2;
  const viewportCenterY = window.innerHeight / 2;

  // Define a tolerance (e.g., 50px) around the center
  const tolerance = 100;

  return Math.abs(elementCenterY - viewportCenterY) <= tolerance;
}

function displayTopGradient(shouldDisplay) {
  if (shouldDisplay) {
    // attach a new class to the div that will slide it in to view
    topGradient.classList.add("visible");
  }
  if (!shouldDisplay) {
    // Remove said class to let it slide out of view
    topGradient.classList.remove("visible");
  } else return;
}

function isElementInViewport(el) {
  const rect = el.getBoundingClientRect();
  return (
    rect.top >= 0 &&
    rect.left >= 0 &&
    rect.bottom <=
      (window.innerHeight || document.documentElement.clientHeight) &&
    rect.right <= (window.innerWidth || document.documentElement.clientWidth)
  );
}
