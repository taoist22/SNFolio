import {AppRegistry, Image} from 'react-native';
import App from './App';
import {name as appName} from './app.json';
import {PluginManager} from 'sn-plugin-lib';
import {LASSO_BUTTON_ID, TOOLBAR_BUTTON_ID} from './src/domain/buttonIds';

const BUTTON_TYPE_TOOLBAR = 1;
const BUTTON_TYPE_LASSO = 2;
const SHOW_TYPE_WITH_UI = 1;

// Lasso data types that activate the button: 0=stroke, 1=title, 2=picture,
// 3=text, 4=link, 5=geometry. Omitting this matches nothing, which is why the
// button never appeared when it was registered without it.
const ALL_LASSO_DATA_TYPES = [0, 1, 2, 3, 4, 5];

AppRegistry.registerComponent(appName, () => App);

PluginManager.init();

// Both buttons register at startup, not from inside a React component — a
// component-scoped registration only exists while the plugin panel is open,
// so the lasso button would never be there when you actually need it.
PluginManager.registerButton(BUTTON_TYPE_TOOLBAR, ['NOTE', 'DOC'], {
  id: TOOLBAR_BUTTON_ID,
  name: 'SNFolio',
  icon: Image.resolveAssetSource(require('./assets/icon.png')).uri,
  showType: SHOW_TYPE_WITH_UI,
});

PluginManager.registerButton(BUTTON_TYPE_LASSO, ['NOTE'], {
  id: LASSO_BUTTON_ID,
  name: 'Add to Calendar',
  icon: Image.resolveAssetSource(require('./assets/icon.png')).uri,
  editDataTypes: ALL_LASSO_DATA_TYPES,
  showType: SHOW_TYPE_WITH_UI,
});
