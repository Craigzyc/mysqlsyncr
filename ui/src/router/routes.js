import DumpDatabase from 'pages/DumpDatabase.vue';
import CompareDatabase from 'pages/CompareDatabase.vue';
import ApplyChanges from 'pages/ApplyChanges.vue';
import MainComponent from 'pages/MainComponent.vue';

const routes = [
  {
    path: '/',
    component: () => import('layouts/MainLayout.vue'),
    children: [
      { path: '', component: MainComponent },
      { path: '/dump', component: DumpDatabase },
      { path: '/compare', component: CompareDatabase },
      { path: '/apply', component: ApplyChanges },
    ],
  },
];


export default routes;
