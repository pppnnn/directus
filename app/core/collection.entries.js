define([
  "app",
  "backbone",
  "core/collection"
],

function(app, Backbone, BaseCollection) {

  var Entries = {};

  var NestedCollection = BaseCollection.extend({

    isNested: true,

    model: Backbone.Model.extend({

      isNested: true,

      parse: function(result) {
        result.data = new Backbone.Model(result.data);
        this.collection.nestedCollection.add(result.data);
        return result;
      },

      //DRY this up please and move it to BB's protoype
      toJSON: function(options) {
        attributes = {};
        attributes.id = this.id;
        attributes.data = this.get('data').toJSON();
        return attributes;
      }

    }),

    trash: [],

    remove: function(model, options) {
      if (!model.isNew()) {
        this.trash.push(model);
      }
      this.constructor.__super__.remove.apply(this, arguments);
    },

    getNew: function(toJSON) {
      var models = this.filter(function(model) { return model.isNew(); });
      if (toJSON) {
        models = _.map(models, function(model) { return model.toJSON(); });
      }
      return models;
    },

    getTrash: function(toJSON) {
      var models = this.trash;
      if (toJSON) {
        models = _.map(models, function(model) { return model.toJSON(); });
      }
      return models;
    },

    getChanged: function(toJSON) {
      var models = this.filter(function(model) { return model.hasChanged(); });
      if (toJSON) {
        models = _.map(models, function(model) { return model.toJSON(); });
      }
      return models;
    },

    parse: function(response) {
      return response.rows;
    },

    initialize: function(models, options) {
      this.structure = options.structure;
      this.table = options.table;
      this.preferences = options.preferences;
      this.filters = options.filters;
      this.nestedCollection = new Entries.Collection({}, options);
      this.nestedCollection.on('change', function() {
        this.trigger('change');
      }, this);
    }

  });

  //The equivalent of a MySQL row.
  Entries.Model =  Backbone.Model.extend({

    parse: function(result) {
      return this.parseRelational(result);
    },

    parseRelational: function(attributes) {
      var type;
      var structure = this.collection.structure;
      var value;
      var id;
      var options;
      var ui;
      var columns;

      structure.each(function(column) {
        type = column.get('type');
        id = column.id;
        ui = structure.get(column).options;

        if (type === 'ONETOMANY' || type === 'MANYTOMANY') {

          columns = ui.get('visible_columns') || '';

          options = {
            table: app. tables.get(column.get('table_related')),
            structure: app.columns[column.get('table_related')],
            preferences: app.preferences[column.get('table_related')],
            parse:true,
            filters: {columns: columns.split(',')}
          };

          value = attributes[id] || [];

          switch (type) {
            case 'ONETOMANY':
              attributes[id] = new Collection(value, options);
              break;
            case 'MANYTOMANY':
              attributes[id] = new NestedCollection(value, options);
              break;
          }
        }

        if (type === 'datetime') {
          attributes[id] = new Date(attributes[id]);
        }

      }, this);

      return attributes;
    },

    toJSON: function(options) {
      var attributes = _.clone(this.attributes);

      _.each(attributes, function(value, key) {
        if (_.isObject(value)) {
          if (typeof value.toJSON === 'function') {
            attributes[key] = value.toJSON();
          } else {
            delete attributes[key];
          }
        }
      });

      // Pick selected columns, useful for collection "save"
      if (options && options.columns) {
        attributes = _.pick(this.attributes, options.columns);
      }

      return attributes;
    },

    //This should probably override the regular save function.
    saveRelational: function(attributes, options) {

      var references = [];

      _.each(this.collection.references, function(collection, tableName) {
        references.push({tableName: tableName, remove: collection.getTrash(true), add: collection.getNew(true), update: collection.getChanged(true)});
      }, this);

      if (references.length) {
        attributes.__references = references;
      }

      this.save(attributes, options);
    }

  });

  // This is a super mega core directus collection. Deals with everything from the DB.
  //
  Entries.Collection = BaseCollection.extend({

    model: Entries.Model,

    getColumns: function() {
      return _.intersection(this.structure.pluck('id'), this.preferences.get('columns_visible').split(','));
    },

    getFilter: function(key) {
      return this.preferences.has(key) ? this.preferences.get(key) : this.filters[key];
    },

    getFilters: function() {
      return _.extend(this.filters, _.pick(this.preferences.toJSON(),'columns_visible','sort','sort_order','active'));
    },

    setFilter: function(key, value, options) {
      var attrs;
      if (key === null || typeof key === 'object') {
        attrs = key;
      } else {
        (attrs = {})[key] = value;
      }
      _.each(attrs, function(value, key) {
        if (this.preferences.has(key)) {
          this.preferences.set(key, value, {silent: true});
        } else {
          this.filters[key] = value;
        }
      },this);
      this.preferences.save();
    },

    initialize: function(models, options) {

      this.structure = options.structure;
      this.table = options.table;
      this.url = this.table.get('url') + '/rows';
      this.filters = options.filters || { currentPage: 0, perPage: 500, sort: 'id', sort_order: 'ASC', active: '1,2' };
      this.preferences = options.preferences;

      this.preferences.on('change', function() { this.trigger('change'); }, this);

    },

    parse: function(response) {
      this.total = response.total;
      return response.rows;
    }

  });

  return Entries;
});




