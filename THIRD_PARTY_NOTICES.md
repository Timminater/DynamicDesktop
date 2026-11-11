# Third-party dependencies

The Windows host uses the Microsoft Edge WebView2 Runtime. A local copy of SDK version `1.0.4191.47` is required to build it. Microsoft components retain their respective licenses.

Windows installers use NSIS 3.13. NSIS and its compression modules retain their own licenses. The installer includes the corresponding application source ZIP.

## Location search

Online location search uses Open-Meteo geocoding, which is based on GeoNames location data. Search terms are sent only when the user submits the search form. Manual coordinate entry and solar lighting work locally.
