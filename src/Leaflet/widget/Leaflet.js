import { defineWidget } from '@/helpers/widget';
import { log, runCallback } from '@/helpers';
import { execute } from '@/helpers/microflow';

import template from './Leaflet.template.html';

require('es6-promise').polyfill();

import Leaflet from 'leaflet';
import 'leaflet-providers';
import 'leaflet.locatecontrol';
import 'leaflet-fullscreen';
import 'leaflet-control-geocoder';
import 'leaflet.markercluster';
import 'leaflet-draw';

import domStyle from 'dojo/dom-style';
import dojoArray from 'dojo/_base/array';
import domAttr from 'dojo/dom-attr';



//import esri from 'esri-leaflet';
import cluster from 'esri-leaflet-cluster';

import 'leaflet/dist/leaflet.css';
import 'leaflet-fullscreen/dist/leaflet.fullscreen.css';
import 'leaflet.locatecontrol/dist/L.Control.Locate.css';
import 'leaflet.locatecontrol/dist/L.Control.Locate.mapbox.css';
import 'leaflet-control-geocoder/dist/Control.Geocoder.css';
import 'leaflet.markercluster/dist/MarkerCluster.css';
import 'leaflet.markercluster/dist/MarkerCluster.Default.css';
import 'leaflet-draw/dist/leaflet.draw.css';

Leaflet.Icon.Default.imagePath = window.require.toUrl('Leaflet/widget/ui/').split('?')[ 0 ];

export default defineWidget('Leaflet', template, {

    // DOM node
    mapContainer: null,

    // Set by modeler
    gotocontext: false,
    defaultLat: 0,
    defaultLng: 0,
    minZoom: 0,
    maxZoom: 20,
    lowestZoom: 10,
    updateRefresh: false,

    mapEntity: "",
    xpathConstraint: "",
    markerDisplayAttr: "",
    latAttr: "",
    lngAttr: "",
    markerCategory: "",
    onClickMarkerMf: "",

    mapHeight: "",
    mapWidth: "",
    markerTemplate: "<p>{Marker}</p>",
    markerDefaultImage: "",
    markerImageAttr: "",
    markerImages: [],

    mapType: "OpenStreetMap_Mapnik",
    customMapType: false,
    customMapTypeUrl: "//{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    customMapTypOptions: "{subdomains:'abc'}",

    controlDragging: true,
    controlTouchZoom: true,
    controlScrollWheelZoom: true,
    controlZoomControl: true,
    controlZoomControlPosition: "topleft",
    controlAttribution: true,
    controlAttributionPosition: "bottomright",
    controlFullscreen: false,
    controlFullscreenPosition: "topright",
    controlCategories: false,
    controlCategoriesPosition: "topright",
    geocoderControl: false,
    geocoderControlPosition: 'topright',
    geocoderProvider: 'nominatim',

    locateControl: false,
    locateControlPosition: "topleft",
    locateControlDrawCircle: true,
    locateControlKeepZoomLevel: false,

    scaleControl: false,
    scaleControlPosition: "bottomleft",
    scaleControlMetric: true,
    scaleControlImperial: true,
    scaleControlMaxWidth: 100,

    googleMapsKey: '',
    mapBoxAccessToken: '',

    // Internal variables
    _markerImages: {},
    _markerCache: [],
    _layerGroup: null,
    _layerCategoryGroups: {},
    _layerController: null,
    _minZoom: 0,
    _maxZoom: 20,

    _defaultPosition: [],
    _handle: null,
    _contextObj: null,
    _map: null,
    _esriLayer: null,
    _currentSelected: null, // object ID
    _currentSelectedUserDefinedID: null, //mak ID
    _drawnItems: null,

    constructor() {
        this.execute = execute.bind(this);
        this.log = log.bind(this);
    },

    postCreate() {
        this.log('postCreate', this._WIDGET_VERSION);
        domAttr.set(this.domNode, 'data-widget-version', this._WIDGET_VERSION);

        this._defaultPosition = [
            parseFloat(this.defaultLat),
            parseFloat(this.defaultLng),
        ];

        this._minZoom = 0 >= this.minZoom ? this.minZoom : 0;
        this._maxZoom = this.maxZoom > this.minZoom ? this.maxZoom : this.minZoom;

        this._layerGroup = new Leaflet.layerGroup();
    },

    update(obj, callback) {
        this.log('update');
        this._contextObj = obj;
        this._resetSubscriptions();

        if(obj) {
            if (!this._map) {
                this._loadMap(callback);
            } else {
                this._fetchMarkers(callback);
            }
        }
    },

    resize() {
        if (this._map) {
            this._map.invalidateSize();
        }
    },

    _resetSubscriptions() {
        this.log('_resetSubscriptions');
        this.unsubscribeAll();

        if (this._contextObj) {
            this.subscribe({
                guid: this._contextObj.getGuid(),
                callback: () => {
                    this._fetchMarkers();
                },
            });
        } else {
            this.subscribe({
                entity: this.mapEntity,
                callback: () => {
                    this._fetchMarkers();
                },
            });
        }

        //subscription for changes to visible or selected ArcGIS items
        if (this._contextObj) {
            if (this.objectIdAttr) {
                this.subscribe({
                    guid: this._contextObj.getGuid(),
                    attr: this.objectIdAttr,
                    callback: () => {
                        this._fetchMarkers();
                    },
                });
            }
            if (this.searchIdsAttr) {
                this.subscribe({
                    guid: this._contextObj.getGuid(),
                    attr: this.searchIdsAttr,
                    callback: () => {
                        this._fetchMarkers();
                    },
                });
            }
            //subscription for changes to new lat/lon points from the context entity
            if (this.newPointLatAttr) {
                this.subscribe({
                    guid: this._contextObj.getGuid(),
                    attr: this.newPointLatAttr,
                    callback: () => {
                        this._createMoveDrawnPoint();
                    },
                });
            }
            if (this.newPointLongAttr) {
                this.subscribe({
                    guid: this._contextObj.getGuid(),
                    attr: this.newPointLongAttr,
                    callback: () => {
                        this._createMoveDrawnPoint();
                    },
                });
            }
        }
    },

    _getMapLayer() {
        this.log('_getMapLayer');
        let tileLayer = null;

        if (this.customMapType && this.customMapTypeUrl) {
            let options = null;

            if ('' !== this.customMapTypeOptions) {
                try {
                    options = JSON.parse(this.customMapTypeOptions);
                } catch (e) {
                    console.warn(this.id + "._getMapLayer error parsing Custom Map Options: " + e.toString() + ", not using these options");
                    options = {};
                }
            }
            tileLayer = Leaflet.tileLayer(this.customMapTypeUrl, options);

        } else {
            const providerName = this.mapType.replace(/_/g, ".");

            if (0 === providerName.indexOf("HERE")) {
                if ('' !== this.hereAppId && '' !== this.hereAppCode) {
                    tileLayer = Leaflet.tileLayer.provider(providerName, {
                        app_id: this.hereAppId, // eslint-disable-line camelcase
                        app_code: this.hereAppCode, // eslint-disable-line camelcase
                    });
                } else {
                    console.error(`${this.id} for HERE maps you need to provide a valid app ID and key.
Get one: http://developer.here.com/`);
                    tileLayer = Leaflet.tileLayer.provider("OpenStreetMap.Mapnik");
                }
            } else {
                tileLayer = Leaflet.tileLayer.provider(providerName);
            }
        }

        if (tileLayer.options.minZoom < this._minZoom) {
            tileLayer.options.minZoom = this._minZoom;
        }

        if (tileLayer.options.maxZoom > this._maxZoom) {
            tileLayer.options.maxZoom = this._maxZoom;
        }

        return tileLayer;
    },

    _loadMap(callback) {
        this.log('_loadMap');

        domStyle.set(this.domNode, {
            height: this.mapHeight,
        });
        domStyle.set(this.mapContainer, {
            height: this.mapHeight,
            width: this.mapWidth,
        });

        this.mapContainer.id = this.id + "_container";

        this._map = Leaflet.map(this.id + "_container", {
            dragging: this.controlDragging,
            touchZoom: this.controlTouchZoom,
            scrollWheelZoom: this.controlScrollWheelZoom,
            zoomControl: this.controlZoomControl,
            attributionControl: this.controlAttribution,
        }).setView(this._defaultPosition, this.lowestZoom);

        if (this.controlZoomControl) {
            this._map.zoomControl.setPosition(this.controlZoomControlPosition);
        }

        if (this.controlAttribution) {
            this._map.attributionControl.setPosition(this.controlAttributionPosition);
        }

        if (this.geocoderControl) {
            this._addGeoCoder();
        }

        if (this.controlFullscreen) {
            Leaflet.control.fullscreen({
                position: this.controlFullscreenPosition,
                forceSeparateButton: true,
            }).addTo(this._map);
        }

        if (this.scaleControl) {
            Leaflet.control.scale({
                position: this.scaleControlPosition,
                maxWidth: 0 < this.scaleControlMaxWidth ? this.scaleControlMaxWidth : 100,
                metric: this.scaleControlMetric,
                imperial: this.scaleControlImperial,
            }).addTo(this._map);
        }

        if (this.locateControl) {
            Leaflet.control.locate({
                position: this.locateControlPosition,
                drawCircle: this.locateControlDrawCircle,
                keepCurrentZoomLevel: this.locateControlKeepZoomLevel,
                icon: "glyphicon glyphicon-screenshot", // Using glyphicons that are part of Mendix
                iconLoading: "glyphicon glyphicon-refresh",
            }).addTo(this._map);
        }

        if (this.markerDefaultImage) {
            const defaultMarkerIcon = Leaflet.icon({
                iconUrl: window.mx.appUrl + this.markerDefaultImage,
            });
            Leaflet.Marker.prototype.options.icon = defaultMarkerIcon;
        }

        if (1 < this.markerImages.length) {
            dojoArray.forEach(this.markerImages, imageObj => {
                const markerIcon = Leaflet.icon({
                    iconUrl: window.mx.appUrl + imageObj.enumImage,
                });
                this._markerImages[ imageObj.enumKey ] = markerIcon;
            });
        }

        this._map.addLayer(this._getMapLayer());
        this._map.setZoom(this.lowestZoom); // trigger setzoom to make sure it is rendered
        this._layerGroup.addTo(this._map);

        if ('' !== this.getGeoJSONMf && '' !== this.entityGeoJSON && '' !== this.attributeGeoJSON) {
            this._addGeoJSON();
        }

        //ARCGis layer
        const token = this._contextObj.get(this.accessTokenAttr);
        const url = this._contextObj.get(this.featureServerURLAttr);
        const self2 = this;
        function onEachFeature(feature, layer) {
            //bind click
            layer.on({
                click: self2._onClickFeatureArcGIS.bind(self2, feature, true),
                contextmenu: self2._onContextFeatureArcGIS.bind(self2, feature),
            });
        }

        const params = {
            url: url,
            pointToLayer: function (geojson, latlng) {
                return Leaflet.circleMarker(latlng);
            },
            fields: ['OBJECTID', 'MAK_ID'],
            //where: "OBJECTID = 1",
            onEachFeature: onEachFeature,
            style: {
                color: '#5B7CBA',
                weight: 2,
                opacity: 0.85,
                fillOpacity: 0.5,
            },
            spiderfyOnMaxZoom: true,
            //showCoverageOnHover: false,
            //zoomToBoundsOnClick: false,
            disableClusteringAtZoom: 5,
            //minZoom: 12,
            //maxZoom: 20,
            where: "1=0",
        };
        if (token) {
            params.token = token;
        }
        this._esriLayer = cluster.featureLayer(params).addTo(this._map);

        //Drawing layer
        if( this.newPointButton) {
            this._prepDrawingLayer();
        }
        this._createMoveDrawnPoint();

        //listenerforOnLocationFound
        this._map.on('locationfound', this._onLocationFound.bind(this));

        //Add the markers
        this._fetchMarkers(callback);
    },

    _prepDrawingLayer() {
        this._drawnItems = new Leaflet.FeatureGroup();
        this._map.addLayer(this._drawnItems);
        const drawControl = new Leaflet.Control.Draw({
            edit: {
                featureGroup: this._drawnItems,
            },
            draw: {
                polygon: false,
                marker: {
                    shapeOptions: {
                        color: '#89ba45',
                        weight: 2,
                        opacity: 0.85,
                        fillOpacity: 0.5,
                    },
                },
                circle: false,
                polyline: false,
                rectangle: false,
                circlemarker: {
                    shapeOptions: {
                        color: '#89ba45',
                        weight: 2,
                        opacity: 0.85,
                        fillOpacity: 0.5,
                    },
                },
                toolbar: {
                    actions: {
                        title: 'Cancel drawing',
                        text: 'Cancel',
                    },
                    finish: {
                        title: 'Finish drawing',
                        text: 'Finish',
                    },
                    undo: {
                        title: 'Delete last point drawn',
                        text: 'Delete last point',
                    },
                    buttons: {
                        circlemarker: 'Draw a circlemarker',
                        marker: 'Draw a marker',
                    },
                },
            },
        });
        this._map.addControl(drawControl);
        this._map.on(Leaflet.Draw.Event.CREATED, function (e) {
            const layer = e.layer;
            this._setEditPointStyle(layer);
            //remove any other points
            this._clearDrawnItems();
            this._drawnItems.addLayer(layer);
            this._updateNewLatLongPoints(layer);
        }.bind(this));
        this._map.on(Leaflet.Draw.Event.EDITED, function (e) {
            const layers = e.layers;
            layers.eachLayer(function (layer) {
                this._updateNewLatLongPoints(layer);
            }.bind(this));
        }.bind(this));
    },

    _onClickFeatureArcGIS(feature, runMF) {
        this.log('_onClickFeatureArcGIS', feature);
        const userID = "MAK_ID".toLowerCase();
        const featureId = feature.properties[ userID ]; //feature.id;
        this._contextObj.set(this.objectIdAttr, featureId);
        const guid = this._contextObj && this._contextObj.getGuid && this._contextObj.getGuid() || null;
        if (runMF && this.clickFeature) {
            this.execute(this.clickFeature, guid, function() {}, err => {
                console.error(this.id + ' Error executing on click ArcGIS microflow: ', err);
            });
        }
        this._setSelectionStyling();
    },

    //Move this point to the edit layer
    _onContextFeatureArcGIS(feature) {
        //const latlng = feature.getLatLng();
        const lat = feature.geometry.coordinates[ 1 ];
        const lng = feature.geometry.coordinates[ 0 ];
        this._contextObj.set(this.newPointLatAttr, lat); //this._roundNumber(latlng.lat, 6));
        this._contextObj.set(this.newPointLongAttr, lng);//this._roundNumber(latlng.long, 6));
        this._onClickFeatureArcGIS(feature, false);

        if (this.rightClickFeature) {
            const guid = this._contextObj && this._contextObj.getGuid && this._contextObj.getGuid() || null;
            this.execute(this.rightClickFeature, guid, function() {}, err => {
                console.error(this.id + ' Error executing on click ArcGIS microflow: ', err);
            });
        }
    },

    _setEditPointStyle(point) {
        point.setStyle({
            color: '#89ba45',
            weight: 3,
            opacity: 0.85,
            fillOpacity: 0.5,
        });
        point.bringToFront();
    },

    _updateNewLatLongPoints(layer) {
        if(this._contextObj && this.newPointLatAttr && this.newPointLongAttr) {
            const latlng = layer.getLatLng();
            const lat = this._roundNumber(latlng.lat, 8);
            const lng = this._roundNumber(latlng.lng, 8);
            const zoomLevel = this._map.getZoom();
            this.unsubscribeAll();
            this._contextObj.set(this.newPointLatAttr, lat); //this._roundNumber(latlng.lat, 6));
            this._contextObj.set(this.newPointLongAttr, lng);//this._roundNumber(latlng.long, 6));
            this._contextObj.set(this.zoomLevel, zoomLevel);
            this._resetSubscriptions();
        }
    },

    _createMoveDrawnPoint() {
        if (this._contextObj && this.newPointLatAttr && this.newPointLongAttr) {
            const lat = this._contextObj.get(this.newPointLatAttr) + 0;
            const lng = this._contextObj.get(this.newPointLongAttr) + 0;

            if(lat && lng) {
                this._clearDrawnItems();
                const marker = Leaflet.circleMarker([lat, lng]);
                this._setEditPointStyle(marker);
                this._drawnItems.addLayer(marker);
            }
        }
    },

    _clearDrawnItems() {
        const drawnItems = this._drawnItems;
        drawnItems.eachLayer(function(l) {
            drawnItems.removeLayer(l);
        });
    },

    _roundNumber(num, dec) {
        return Math.round(num * Math.pow(10, dec)) / Math.pow(10, dec);
    },

    _addGeoCoder() {
        this.log('_addGeoCoder');

        const onMarkGeoCode = e => {
            setTimeout(() => {
                const marker = e.sourceTarget._geocodeMarker;
                if (marker) {
                    this._map.once('click', () => {
                        marker.remove();
                    });
                }
            }, 10);
        };

        let provider = this.geocoderProvider;
        if ('bing' === provider && '' === this.bingMapsKey) {
            console.warn(this.id + ' :: For GeoCoder using Bing, we need a Maps key. See widget');
            provider = 'nominatim';
        } else if ('here' === provider && !('' !== this.hereAppId && '' !== this.hereAppCode)) {
            console.warn(this.id + ' :: For GeoCoder using HERE, we need a App Id and App Code.');
            provider = 'nominatim';
        }

        let geoCoderProvider = null;

        if ('bing' === provider) {
            geoCoderProvider = new Leaflet.Control.Geocoder.Bing(this.bingMapsKey);
        } else if ('google' === provider) {
            geoCoderProvider = new Leaflet.Control.Geocoder.Google(this.googleMapsKey);
        } else if ('mapbox' === provider) {
            geoCoderProvider = new Leaflet.Control.Geocoder.Mapbox(this.mapBoxAccessToken);
        } else if ('here' === provider) {
            geoCoderProvider = new Leaflet.Control.Geocoder.HERE({
                app_id: this.hereAppId, // eslint-disable-line camelcase
                app_code: this.hereAppCode, // eslint-disable-line camelcase
            });
        } else {
            geoCoderProvider = new Leaflet.Control.Geocoder.Nominatim();
        }

        Leaflet.Control
            .geocoder({
                position: this.geocoderControlPosition,
                geocoder: geoCoderProvider,
            })
            .on('markgeocode', onMarkGeoCode)
            .addTo(this._map);
    },

    _addGeoJSON() {
        this.log('_addGeoJSON');
        const guid = this._contextObj && this._contextObj.getGuid && this._contextObj.getGuid() || null;

        this.execute(this.getGeoJSONMf, guid, objs => {
            dojoArray.forEach(objs, obj => {
                const content = obj.get(this.attributeGeoJSON);
                if (content) {
                    let geoJSON = null;
                    try {
                        geoJSON = JSON.parse(content);
                    } catch (e) {
                        console.error(this.id + ' Error parsing GeoJSON: ', e);
                        geoJSON = null;
                    }

                    if (null !== geoJSON) {
                        Leaflet.geoJSON(geoJSON, {
                            style: feature => {
                                return feature.properties && feature.properties.style;
                            },
                            onEachFeature: (feature, layer) => {
                                layer.on({
                                    click: () => {
                                        this._onClickFeature(feature);
                                    },
                                });
                            },
                        }).addTo(this._map);
                    }
                }
            });
        }, err => {
            console.error(this.id + ' Error executing GeoJSON microflow: ', err);
        });
    },

    _onClickFeature(feature) {
        this.log('_onClickFeature', feature);

        if ('' !== this.entityGeoJSONFeature && '' !== this.attributeGeoJSONFeatureId && 'undefined' !== typeof feature.id) {
            mx.data.create({
                entity: this.entityGeoJSONFeature,
                callback: createdObj => {
                    createdObj.set(this.attributeGeoJSONFeatureId, feature.id);
                    if ('' !== this.clickGeoJSONFeature) {
                        this.execute(this.clickGeoJSONFeature, createdObj.getGuid());
                    }
                },
                error: e => {
                    console.error(this.id + ' Error creating GeoJSON feature: ', e);
                },
            });
        } else if ('' !== this.clickGeoJSONFeature) {
            this.execute(this.clickGeoJSONFeature);
        }
    },

    _updateLayerControls() {
        this.log('_updateLayerControls');

        if (!this.controlCategories) {
            return;
        }
        logger.debug(this.id + "._updateLayerControls");

        if (this._map) {
            if (this._layerController) {
                this._layerController.remove();
                this._layerController = null;
            }
            // Because we added an id to the category (making sure this is on the same map (seems a bug), we need to copy this)
            const layerCategoryGroups = {};
            let add = false; // If there are no layercategorygroups, don't add the control

            Object
                .keys(this._layerCategoryGroups)
                .forEach(key => {
                    add = true;
                    layerCategoryGroups[ key.replace("_" + this.id, "") ] = this._layerCategoryGroups[ key ];
                });

            if (add) {
                this._layerController = Leaflet.control.layers({}, layerCategoryGroups, {
                    position: this.controlCategoriesPosition,
                }).addTo(this._map);
                this._layerController.setPosition(this.controlCategoriesPosition);
            }

        }
    },

    _fetchMarkers(callback) {
        this.log('_fetchMarkers');

        if (this._contextObj) {
            const searchKeys = this._contextObj.get(this.searchIdsAttr);
            const selectedKey = this._contextObj.get(this.objectIdAttr);

            const fl = this._esriLayer;
            const map = this._map;
            //if we have keys to search on, fire the search and focus the map on the results.
            let searchQuery = "1=0";
            if ("" !== searchKeys) {
                searchQuery = "MAK_ID IN (" + searchKeys + ")";
            }
            const self2 = this;
            if (searchQuery !== this._currentQuery) {
                fl.query().where(searchQuery).bounds(function(error, latLngBounds){
                    if(!error) {
                        map.fitBounds(latLngBounds.pad(0.15));
                    }
                    fl.setWhere(searchQuery, self2._setSelectionStyling.bind(self2));
                });
                this._currentQuery = searchQuery;
            } else if (selectedKey !== this._currentSelectedUserDefinedID) {
                this._setSelectionStyling();
            }
        }
        if (this.gotocontext) {
            this._goToContext(callback);
        } else if (this.updateRefresh) {
            this._fetchFromDB(callback);
        } else if (this._markerCache) {
            this._fetchFromCache(callback);
        } else {
            this._fetchFromDB(callback);
        }
    },

    //Callback used when the ESRI where clause changes
    //Sets selected feature styling
    _setSelectionStyling() {
        if (this._contextObj) {
            const objKey = this._contextObj.get(this.objectIdAttr);
            const fl = this._esriLayer;
            //if we have keys to search on, fire the search and focus the map on the results.
            if ("" !== objKey) {
                const self2 = this;
                fl.query().where("MAK_ID = " + objKey).ids(function(error, ids){
                    if (ids && 0 < ids.length) {
                        const pkID = ids[ 0 ];
                        if (self2._currentSelected) {
                            fl.resetStyle(self2._currentSelected);
                        }

                        if (pkID) {
                            fl.setFeatureStyle(pkID, {
                                color: '#BA454E',
                                weight: 2,
                                opacity: 0.85,
                                fillOpacity: 0.5,
                            });
                        }
                        self2._currentSelected = pkID;
                        self2._currentSelectedUserDefinedID = objKey;
                    }
                });
            }
        }
    },

    _centerMapOnMarker(marker) {
        const latLngs = [ marker.getLatLng() ];
        const markerBounds = Leaflet.latLngBounds(latLngs);
        this._map.fitBounds(markerBounds);
    },
    _refreshMap(objs, callback) {
        this.log('_refreshMap');

        //let panPosition = this._defaultPosition;
        //const positions = [];

        /*
        dojoArray.forEach(objs, obj => {
            this._addMarker(obj);
            const position = this._getLatLng(obj);
            if (position) {
                positions.push(position); // reversing lat lng for boundingExtent
                panPosition = position;
            } else {
                const la = this.checkAttrForDecimal(obj, this.latAttr);
                const lo = this.checkAttrForDecimal(obj, this.lngAttr);
                logger.error(this.id + ": " + "Incorrect coordinates (" + la + "," + lo + ")");
            }
        });

        if (2 > positions.length) {
            this._map.setZoom(this.lowestZoom);
            this._map.panTo(panPosition);
        } else {
            this._map.fitBounds(positions);
        }
*/

        runCallback.call(this, callback, "_refreshMap");
    },

    _fetchFromDB(callback) {
        this.log('_fetchFromDB');

        let xpath = "//" + this.mapEntity + this.xpathConstraint;

        this._removeAllMarkers();

        if (this._contextObj) {
            xpath = xpath.replace("[%CurrentObject%]", this._contextObj.getGuid());
            mx.data.get({
                xpath: xpath,
                callback: objs => {
                    this._refreshMap(objs, callback);
                },
            });
        } else if (!this._contextObj && -1 < xpath.indexOf("[%CurrentObject%]")) {
            console.warn("No context for xpath, not fetching.");
            runCallback.call(this, callback, "_fetchFromDB");
        } else {
            mx.data.get({
                xpath: xpath,
                callback: objs => {
                    this._refreshMap(objs, callback);
                },
            });
        }
    },

    _fetchFromCache(callback) {
        this.log('_fetchFromCache');

        let cached = false;
        const bounds = [];

        this._removeAllMarkers();

        dojoArray.forEach(this._markerCache, (markerObj, index) => {
            if (markerObj && markerObj.marker) {
                if (this._contextObj) {
                    if (markerObj.id === this._contextObj.getGuid()) {
                        markerObj.marker.addTo(this._map);
                        bounds.push(markerObj.loc);
                        cached = true;
                    }
                } else {
                    markerObj.marker.addTo(this._map);
                }
                if (index === this._markerCache.length - 1 && 0 < bounds.length) {
                    this._map.fitBounds(bounds);
                }
            }
        });

        if (!cached) {
            this._fetchFromDB(callback);
        } else {
            runCallback.call(this, callback, "_fetchFromCache");
        }
    },

    _removeAllMarkers() {
        this.log('_removeAllMarkers');

        if (this._map) {
            this._layerGroup.clearLayers();
            this._layerCategoryGroups = {};
        }
    },

    _addMarker(obj) {
        this.log('_addMarker');

        const id = this._contextObj ? this._contextObj.getGuid() : null;
        const lat = parseFloat(this.checkAttrForDecimal(obj, this.latAttr));
        const lng = parseFloat(this.checkAttrForDecimal(obj, this.lngAttr));
        const loc = [lat, lng];
        const markerObj = {
            context: id,
            obj: obj,
            marker: null,
            loc: loc,
        };

        let marker;
        if (this.markerImageAttr && this._markerImages && this._markerImages[ obj.get(this.markerImageAttr) ]) {
            marker = Leaflet.marker(loc, {
                icon: this._markerImages[ obj.get(this.markerImageAttr) ],
            });
        } else {
            marker = Leaflet.marker(loc);
        }

        if ('' !== this.onClickMarkerMf) {
            marker.on("click", () => {
                console.log(this, obj, obj.getGuid());
                execute.call(this, this.onClickMarkerMf, obj.getGuid());
            });
        }

        if (this.markerDisplayAttr) {
            const markerTemplate = '' !== this.markerTemplate ?
                this.markerTemplate.replace("{Marker}", obj.get(this.markerDisplayAttr)) :
                "<p>" + obj.get(this.markerDisplayAttr) + "<p/>";

            marker.bindPopup(markerTemplate, {
                closeButton: false,
            });
        }

        if (this.markerCategory && this.controlCategories) {
            const category = obj.get(this.markerCategory);
            if (category) {
                let layerCategory = this._layerCategoryGroups[ category + "_" + this.id ];
                if (!layerCategory) {
                    layerCategory = this._layerCategoryGroups[ category + "_" + this.id ] = new Leaflet.layerGroup();
                    this._layerGroup.addLayer(layerCategory);
                }
                layerCategory.addLayer(marker);
            } else {
                this._layerGroup.addLayer(marker);
            }
        } else {
            this._layerGroup.addLayer(marker);
        }

        markerObj.marker = marker;

        if (!this._markerCache) {
            this._markerCache = [];
        }

        let found = false;
        dojoArray.forEach(this._markerCache, mObj => {
            if (mObj.obj.getGuid() === obj.getGuid()) {
                found = true;
            }
        });

        if (!found) {
            this._markerCache.push(markerObj);
        }

        this._updateLayerControls();
    },

    checkAttrForDecimal(obj, attr) {
        this.log('checkAttrForDecimal');

        if ('Decimal' === obj.get(attr)) {
            return obj.get(attr).toFixed(5);
        }
        return obj.get(attr);
    },

    _getLatLng(obj) {
        this.log('_getLatLng');

        const lat = this.checkAttrForDecimal(obj, this.latAttr);
        const lng = this.checkAttrForDecimal(obj, this.lngAttr);

        if ('' === lat && '' === lng) {
            return this._defaultPosition;
        }

        if (!isNaN(lat) && !isNaN(lng) && '' !== lat && '' !== lng) {
            return [
                parseFloat(lat),
                parseFloat(lng),
            ];
        }

        return null;
    },

    _goToContext(callback) {
        this.log('_goToContext');

        this._removeAllMarkers();
        if (this._map && this._contextObj) {
            let objs = [];
            if (this._contextObj) {
                objs = [ this._contextObj ];
            } else {
                logger.error(this.id + "._goToContext: no Context object while you have set" +
                " \"Pan to context\" in the Modeler! Showing default position");
            }
            this._refreshMap(objs, callback);
        } else {
            runCallback.call(this, callback, "_goToContext");
        }
    },

    _onLocationFound(e) {
        //e.latlng;
        console.log("you are here:" + e.latlng.toString());
        const fl = this._esriLayer;
        fl.query().nearby(e.latlng, 500).ids(function(error, ids){
            if (ids && 0 < ids.length) {
                const ida = ids.join(",");
                fl.setWhere("OBJECTID IN (" + ida + ")");
            }
        });
    },

});
